// Copy, cut, paste and duplicate on a board. What is copied is kept in the
// window, so it pastes onto this board or another one, with the lines
// between the copied things; the copies get new ids and go in through the
// core's `restore`, one step to undo. A note's card stays one per board,
// so a card already on the board is left out of a paste. The words of what
// was copied also go to the system clipboard, to paste into a page.

import type { BoardEdge, BoardNode } from "../../../../lib/vault/types";
import type { Point } from "../model/placement";
import { rawEdge, rawNode } from "../model/raw";
import type { BoardController } from "./controller";
import { removeFromBoard } from "./gestures";
import { select, selectedNodes } from "./store";

interface Copied {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

let copied: Copied | null = null;

/** How far a duplicate, or a paste onto the same spot, sits from what it copies. */
const STEP = 24;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^0-9a-f]/gi, "").slice(0, 16);

/** What is selected, with the lines between the selected things. */
function selection(board: BoardController): Copied {
  const state = board.store.getState();
  const nodes = selectedNodes(state).map((n) => board.node(n.id)).filter((n): n is BoardNode => Boolean(n));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = board.doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges };
}

/** The words of what was copied, one thing a line, for a page. */
function wordsOf(nodes: readonly BoardNode[]): string {
  return nodes
    .map((n) => (n.kind === "file" ? (n.title ?? n.file ?? "") : n.kind === "link" ? (n.url ?? "") : n.kind === "group" ? (n.label ?? "") : n.draw ? "" : (n.text ?? "")))
    .filter(Boolean)
    .join("\n");
}

/** Copies what is selected; how many things. */
export function copySelection(board: BoardController): number {
  const picked = selection(board);
  if (picked.nodes.length === 0) return 0;
  copied = picked;
  const words = wordsOf(picked.nodes);
  // The words are a courtesy for other apps: pasting on the board uses `copied`, so a refused clipboard costs nothing here.
  if (words) void navigator.clipboard?.writeText(words).catch(() => {});
  return picked.nodes.length;
}

/** Copies what is selected and takes it off the board (the notes stay). */
export function cutSelection(board: BoardController): number {
  const n = copySelection(board);
  if (n && copied) removeFromBoard(board, copied.nodes.map((node) => node.id), copied.edges.map((e) => e.id));
  return n;
}

/** Puts copies of `from` on the board, moved by `dx`, `dy`, and selects
 * them; how many went on, and how many cards were there already. */
async function place(board: BoardController, from: Copied, dx: number, dy: number): Promise<{ placed: number; skipped: number }> {
  const onBoard = new Set(board.doc.nodes.filter((n) => n.kind === "file").map((n) => n.file));
  const nodes = from.nodes.filter((n) => !(n.kind === "file" && onBoard.has(n.file)));
  const skipped = from.nodes.length - nodes.length;
  if (nodes.length === 0) return { placed: 0, skipped };
  const ids = new Map(nodes.map((n) => [n.id, newId()]));
  const copies = nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }));
  const lines = from.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...e, id: newId(), from: ids.get(e.from)!, to: ids.get(e.to)! }));
  const sized = copies.flatMap((n) => [
    ...(n.kind === "file" && n.size ? [{ kind: "card_size" as const, id: n.id, size: n.size }] : []),
    ...(n.kind === "group" && n.collapsed ? [{ kind: "collapse" as const, id: n.id, collapsed: true }] : []),
  ]);
  const applied = await board.commit([{ kind: "restore", nodes: copies.map(rawNode), edges: lines.map(rawEdge) }, ...sized]);
  if (!applied) return { placed: 0, skipped };
  select(board.store, copies.map((n) => n.id));
  return { placed: copies.length, skipped };
}

/** The copied things' middle. */
function middle(nodes: readonly BoardNode[]): Point {
  const left = Math.min(...nodes.map((n) => n.x));
  const top = Math.min(...nodes.map((n) => n.y));
  const right = Math.max(...nodes.map((n) => n.x + n.width));
  const bottom = Math.max(...nodes.map((n) => n.y + n.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** Pastes what was copied, centred on `at` (the middle of the view). */
export async function pasteCopied(board: BoardController, at: Point): Promise<void> {
  if (!copied) return;
  const from = middle(copied.nodes);
  // Onto the same spot of the same board, it sits a step down and right.
  const same = copied.nodes.every((n) => board.node(n.id)?.x === n.x && board.node(n.id)?.y === n.y);
  const [dx, dy] = same && Math.hypot(at.x - from.x, at.y - from.y) < STEP ? [STEP, STEP] : [at.x - from.x, at.y - from.y];
  report(board, await place(board, copied, dx, dy));
}

/** Copies what is selected beside itself, a step down and right. */
export async function duplicateSelection(board: BoardController): Promise<void> {
  const picked = selection(board);
  if (picked.nodes.length) report(board, await place(board, picked, STEP, STEP));
}

function report(board: BoardController, { placed, skipped }: { placed: number; skipped: number }): void {
  if (skipped === 0) return;
  const cards = `${skipped} ${skipped === 1 ? "card is" : "cards are"} on this board already`;
  board.deps.toast(placed ? `Pasted ${placed}; ${cards}` : `A note's card goes on a board once: ${cards}`);
}

/** Whether anything was copied, for the menu. */
export const hasCopied = () => copied !== null && copied.nodes.length > 0;
