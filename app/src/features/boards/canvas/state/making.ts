// Making new things on a board: cards for new or existing notes, stickies,
// sections, link cards and nested boards. Each lands near where it was
// asked for, is selected, and waits to be written in when it has text.

import type { ShapeKind } from "../../../../lib/vault/types";
import { editDiagram } from "../../../diagrams/host-store";
import type { OpenHow } from "../../../workspace/store";
import { CARD, STICKY } from "../model/geometry";
import { toStroke } from "../nodes/outlines";
import { childSpot, parentOf } from "../model/mind-map";
import { centredAt, dropGrid, freeSpot, type Point } from "../model/placement";
import type { BoardController } from "./controller";
import { EXPANDED, webAddress } from "./gestures";
import { select } from "./store";

/** A new, empty section. */
const SECTION = { width: 640, height: 400 } as const;

/** The project a board belongs to: the folder of `projects/<p>/boards/…`. */
export function projectOf(path: string): string | null {
  const parts = path.split("/");
  return parts[0] === "projects" && parts[2] === "boards" && parts[1] ? parts[1] : null;
}

/** A new card for a new note at `at`, expanded and ready to type in. The
 * note goes in the board's project's cards, else in the inbox. */
export async function newCard(board: BoardController, at: Point): Promise<string | null> {
  const note = await board.deps.create({ kind: "card", title: "", project: projectOf(board.path) });
  if (!note) return null;
  const spot = freeSpot(board.doc.nodes, at);
  // Two batches (the second needs the card's id), undone as one.
  const group = `new:${note.meta.path}`;
  const first = await board.commit([{ kind: "card", path: note.meta.path, x: spot.x, y: spot.y }], { group });
  const id = first?.made[0];
  if (!id) return null;
  await board.commit([{ kind: "card_size", id, size: "expanded" }, { kind: "place", id, x: spot.x, y: spot.y, ...EXPANDED }], { group });
  select(board.store, [id]);
  board.store.setState({ focusCard: { id, at: "title" } });
  return id;
}

export async function addSticky(board: BoardController, at: Point): Promise<string | null> {
  const spot = freeSpot(board.doc.nodes, centredAt(at, STICKY));
  const applied = await board.commit([{ kind: "sticky", text: "", x: spot.x, y: spot.y }]);
  const id = applied?.made[0];
  if (!id) return null;
  select(board.store, [id]);
  board.store.setState({ editing: id });
  return id;
}

/** Mind-map mode's Tab: a new sticky joined to `parent`, right of it and
 * below its other children, to write in at once. One step to undo. */
export async function addChild(board: BoardController, parent: string): Promise<string | null> {
  const node = board.node(parent);
  if (!node || node.kind === "group") return null;
  const spot = childSpot(board.doc.nodes, board.doc.edges, parent);
  const group = `child:${parent}:${Date.now()}`;
  const made = await board.commit([{ kind: "sticky", text: "", x: spot.x, y: spot.y }], { group });
  const id = made?.made[0];
  if (!id) return null;
  await board.commit([{ kind: "connect", from: parent, to: id, fromSide: "right", toSide: "left" }], { group });
  select(board.store, [id]);
  board.store.setState({ editing: id });
  return id;
}

/** Mind-map mode's Shift+Enter: a new sticky beside `id` under the same
 * parent, or below it when it has none. */
export async function addSibling(board: BoardController, id: string): Promise<string | null> {
  const parent = parentOf(board.doc.nodes, board.doc.edges, id);
  if (parent) return addChild(board, parent);
  const node = board.node(id);
  if (!node || node.kind === "group") return null;
  const applied = await board.commit([{ kind: "sticky", text: "", x: node.x, y: node.y + node.height + 24 }]);
  const made = applied?.made[0];
  if (!made) return null;
  select(board.store, [made]);
  board.store.setState({ editing: made });
  return made;
}

/** A shape in `box`, selected and ready for its label. */
export async function addShape(board: BoardController, kind: ShapeKind, box: { x: number; y: number; width: number; height: number }): Promise<string | null> {
  const rounded = { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) };
  const applied = await board.commit([{ kind: "shape", shape: kind, text: "", ...rounded }]);
  const id = applied?.made[0];
  if (!id) return null;
  select(board.store, [id]);
  board.store.setState({ editing: id });
  return id;
}

/** A line drawn through `points` (board units) with the board's pen. */
export async function addDrawing(board: BoardController, points: readonly Point[]): Promise<string | null> {
  const { pen } = board.store.getState();
  const stroke = toStroke(points, pen.size);
  if (!stroke) return null;
  const applied = await board.commit([{ kind: "draw", ...stroke, size: pen.size, ...(pen.color ? { color: pen.color } : {}) }]);
  return applied?.made[0] ?? null;
}

export async function addSection(board: BoardController, at: Point): Promise<string | null> {
  const spot = centredAt(at, SECTION);
  const applied = await board.commit([{ kind: "section", label: "Section", x: spot.x, y: spot.y, ...SECTION }]);
  const id = applied?.made[0];
  if (!id) return null;
  select(board.store, [id]);
  board.store.setState({ editing: id });
  return id;
}

export async function addLink(board: BoardController, url: string, at: Point): Promise<string | null> {
  const address = webAddress(url);
  const spot = freeSpot(board.doc.nodes, centredAt(at, CARD));
  const applied = await board.commit([{ kind: "link", url: address, x: spot.x, y: spot.y }]);
  const id = applied?.made[0];
  if (id) select(board.store, [id]);
  return id ?? null;
}

/** Cards for notes (or boards) centred on `at`, several in a small grid.
 * Notes already on the board keep their card where it is; all of them end
 * up selected. */
export async function addNotes(board: BoardController, paths: readonly string[], at: Point): Promise<string[]> {
  const known = new Set(board.deps.notes().map((n) => n.path));
  const wanted = [...new Set(paths)].filter((p) => p !== board.path && (known.has(p) || p.endsWith(".canvas") || p.endsWith(".drawio")));
  if (wanted.length === 0) return [];
  const corners = dropGrid(at, wanted.length);
  const applied = await board.commit(wanted.map((path, i) => ({ kind: "card", path, x: corners[i]!.x, y: corners[i]!.y })));
  const ids = applied?.made ?? [];
  if (ids.length) select(board.store, ids);
  return ids;
}

/** A new board in this board's project, shown here as a nested board. */
export async function addNewBoard(board: BoardController, title: string, at: Point): Promise<string | null> {
  try {
    const path = await board.deps.client.createBoard(title, projectOf(board.path));
    const [id] = await addNotes(board, [path], at);
    return id ?? null;
  } catch (err) {
    board.deps.toast(err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Opens what a file card shows: a note where asked (the side stack by
 * default), a nested board in this tab unless asked otherwise, a diagram in
 * the editor over the board unless a tab or a split was asked for. */
export function openFile(board: BoardController, file: string, how: OpenHow): void {
  if (file.endsWith(".drawio")) {
    if (how === "here" || how === "stack") editDiagram(file);
    else board.deps.open(file, how);
    return;
  }
  if (file.endsWith(".canvas")) {
    if (how === "here" || how === "stack") board.deps.enter(file);
    else board.deps.open(file, how);
    return;
  }
  if (file.endsWith(".md")) board.deps.open(file, how === "here" ? "stack" : how);
}
