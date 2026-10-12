import { describe, expect, it } from "vitest";

import type { BoardInfo, NoteMeta } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { findOrMakeMap, mapFromPage, mapsOf } from "./page-map";
import { SEED, TRIP } from "./map-fixtures";
import { outlineTree } from "./outline";

async function trip(): Promise<{ vault: MemoryVault; note: NoteMeta }> {
  const vault = new MemoryVault(SEED);
  const note = (await vault.list()).find((n) => n.title === "Seaside trip")!;
  return { vault, note };
}

const texts = (board: Awaited<ReturnType<MemoryVault["board"]>>) => board.nodes.filter((n) => n.kind === "text").map((n) => n.text);

describe("a mind map from a page", () => {
  it("makes a board with the page at the root and its outline as branches", async () => {
    const { vault, note } = await trip();
    const path = await mapFromPage(vault, note);
    expect(path.startsWith("projects/trip/boards/")).toBe(true);
    const board = await vault.board(path);
    expect(board.title).toBe("Seaside trip map");
    const root = board.nodes.find((n) => n.file === note.path)!;
    expect(texts(board)).toContain("Where to stay");
    expect(texts(board)).toContain("close to the trams");
    expect(board.edges).toHaveLength(texts(board).length);
    // Laid out as a tree from the left: every branch right of the root.
    const byText = (t: string) => board.nodes.find((n) => n.text === t)!;
    expect(byText("Where to stay").x).toBeGreaterThan(root.x);
    expect(byText("Baixa").x).toBeGreaterThan(byText("Where to stay").x);
    expect(byText("What to eat").y).toBeGreaterThan(byText("Where to stay").y);
    expect(board.edges.every((e) => e.fromSide === "right" && e.toSide === "left")).toBe(true);
  });

  it("remembers the page, and the line each branch came from", async () => {
    const { vault, note } = await trip();
    const board = await vault.board(await mapFromPage(vault, note));
    const root = board.nodes.find((n) => n.file === note.path)!;
    expect(board.source?.page).toBe(note.id);
    expect(board.source?.root).toBe(root.id);
    const branches = board.source!.branches!;
    expect(Object.keys(branches)).toHaveLength(texts(board).length);
    const idOf = (text: string) => board.nodes.find((n) => n.text === text)!.id;
    expect(branches[idOf("Where to stay")]).toEqual({ parent: "", key: "where to stay", text: "Where to stay" });
    expect(branches[idOf("close to the trams")]).toEqual({ parent: idOf("Baixa"), key: "close to the trams", text: "close to the trams" });
    expect((await vault.boards())[0]!.source).toBe(note.id);
  });

  it("makes one map per page, however often it is asked", async () => {
    const { vault, note } = await trip();
    const first = await findOrMakeMap(vault, note);
    const second = await findOrMakeMap(vault, note);
    const third = await findOrMakeMap(vault, note);
    expect([first.created, second.created, third.created]).toEqual([true, false, false]);
    expect(second.path).toBe(first.path);
    expect(third.path).toBe(first.path);
    expect(await vault.boards()).toHaveLength(1);
    expect(second.copies).toEqual([]);
  });

  it("is still one map when asked twice at once, as a double click does", async () => {
    const { vault, note } = await trip();
    const [a, b] = await Promise.all([findOrMakeMap(vault, note), findOrMakeMap(vault, note)]);
    expect(b.path).toBe(a.path);
    expect(await vault.boards()).toHaveLength(1);
  });

  it("finds it again after the page is renamed or moved, whatever the board is called", async () => {
    const { vault, note } = await trip();
    const path = await mapFromPage(vault, note);
    const renamed = await vault.rename(note.path, "Coast trip");
    expect(await mapFromPage(vault, renamed.note.meta)).toBe(path);
    const moved = await vault.move(renamed.note.meta.path, null);
    expect(moved.meta.project).toBeNull();
    expect(await mapFromPage(vault, moved.meta)).toBe(path);
    expect(await vault.boards()).toHaveLength(1);
    // The map's own name has nothing to do with it either.
    await vault.createBoard("Seaside trip map", "trip");
    expect(await mapFromPage(vault, moved.meta)).toBe(path);
  });

  it("keeps maps of different pages apart", async () => {
    const { vault, note } = await trip();
    const other = await vault.create({ kind: "page", title: "Winter trip", date: "2026-10-06", project: "trip", body: "## Skis\n- rent them\n" });
    const a = await mapFromPage(vault, note);
    const b = await mapFromPage(vault, other.meta);
    expect(b).not.toBe(a);
    expect((await mapsOf(vault, note)).map((m) => m.path)).toEqual([a]);
  });

  it("says so when a page has nothing to map, and makes no board", async () => {
    const vault = new MemoryVault({ "library/plain.md": "---\ntitle: Plain\n---\nJust words.\n" });
    const note = (await vault.list())[0]!;
    await expect(mapFromPage(vault, note)).rejects.toThrow(/headings or lists/);
    expect(await vault.boards()).toEqual([]);
  });
});

/** A map as the first versions made them: no record of the page, a card and
 * a sticky per line, joined. */
async function oldMap(vault: MemoryVault, note: NoteMeta): Promise<string> {
  const path = await vault.createBoard(`${note.title} map`, note.project);
  const lines: [string, number][] = [];
  const walk = (nodes: ReturnType<typeof outlineTree>, parent: number) => {
    for (const n of nodes) {
      lines.push([n.text, parent]);
      walk(n.children, lines.length);
    }
  };
  walk(outlineTree(TRIP), 0);
  const made = await vault.boardApply(path, [{ kind: "card", path: note.path, x: 0, y: 0 }, ...lines.map(([text], i) => ({ kind: "sticky" as const, text, x: 400 * (i + 1), y: 0 }))]);
  await vault.boardApply(path, lines.map(([, parent], i) => ({ kind: "connect" as const, from: made.made[parent]!, to: made.made[i + 1]!, fromSide: "right" as const, toSide: "left" as const })));
  return path;
}

describe("maps made before maps knew their page", () => {
  it("opens one instead of making another, and marks it with the page", async () => {
    const { vault, note } = await trip();
    const path = await oldMap(vault, note);
    const before = await vault.board(path);
    const opened = await findOrMakeMap(vault, note);
    expect(opened).toEqual({ path, created: false, copies: [] });
    expect(await vault.boards()).toHaveLength(1);
    const after = await vault.board(path);
    expect(after.source?.page).toBe(note.id);
    expect(Object.keys(after.source!.branches!)).toHaveLength(texts(before).length);
    // Marking it adds nothing and moves nothing.
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
  });

  it("opens the most recently edited of several, and lists the others as copies", async () => {
    const { vault, note } = await trip();
    const paths = [await oldMap(vault, note), await oldMap(vault, note), await oldMap(vault, note)];
    const stamped = (await vault.boards()).map((b, i): BoardInfo => ({ ...b, modified: 100 + (b.path === paths[1] ? 50 : i) }));
    // The preview stamps every board with the same time; these were edited at different ones.
    const client = {
      read: vault.read.bind(vault),
      boards: async () => stamped,
      boardsWith: vault.boardsWith.bind(vault),
      board: vault.board.bind(vault),
      boardApply: vault.boardApply.bind(vault),
      createBoard: vault.createBoard.bind(vault),
    };
    const opened = await findOrMakeMap(client, note);
    expect(opened.path).toBe(paths[1]);
    expect(opened.created).toBe(false);
    expect(opened.copies.map((c) => c.path).sort()).toEqual([paths[0], paths[2]].sort());
    expect(await vault.boards()).toHaveLength(3);
  });

  it("leaves alone a board that only looks like one: another title, or without the page's card", async () => {
    const { vault, note } = await trip();
    const other = await vault.createBoard("Trip ideas", "trip");
    await vault.boardApply(other, [{ kind: "card", path: note.path, x: 0, y: 0 }]);
    await vault.createBoard("Seaside trip map", "trip");
    expect(await mapsOf(vault, note)).toEqual([]);
    const opened = await findOrMakeMap(vault, note);
    expect(opened.created).toBe(true);
    expect((await mapsOf(vault, note)).map((m) => m.path)).toEqual([opened.path]);
  });
});
