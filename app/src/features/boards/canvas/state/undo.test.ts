// Board undo: a failed save keeps the earlier steps, a page-map sync is not a
// step of its own, and every kind of change undoes, redoes and undoes again.

import { describe, expect, it, vi } from "vitest";

import type { BoardChange } from "../../../../lib/vault/types";
import { MemoryVault } from "../../../workspace/preview/memory-vault";
import type { BoardDoc } from "../model/apply";
import { BoardController, type BoardDeps } from "./controller";

const BOARD = "projects/demo/boards/plan.canvas";

async function setup() {
  const vault = new MemoryVault({
    "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\n",
    "projects/demo/cards/a.md": "---\ntitle: A\n---\nA.\n",
    "library/b.md": "---\ntitle: B\n---\nB.\n",
    [BOARD]: JSON.stringify({
      nodes: [
        { id: "s", type: "group", label: "S", x: -40, y: -80, width: 800, height: 400 },
        { id: "c", type: "file", file: "projects/demo/cards/a.md", x: 0, y: 0, width: 320, height: 180 },
        { id: "t", type: "text", text: "T", x: 400, y: 0, width: 260, height: 120 },
        { id: "u", type: "text", text: "U", x: 400, y: 600, width: 260, height: 120 },
        { id: "l", type: "link", url: "https://example.com", x: 2000, y: 0, width: 320, height: 180 },
      ],
      edges: [{ id: "e", fromNode: "c", toNode: "t" }],
    }),
  });
  const toast = vi.fn();
  const deps: BoardDeps = {
    client: vault,
    notes: () => [],
    toast,
    open: vi.fn(),
    create: async () => null,
    trash: async () => {},
    enter: vi.fn(),
  };
  const board = new BoardController(BOARD, await vault.board(BOARD), deps);
  return { vault, board, toast };
}

/** Order-free: undo may put a node back at another place in the list. */
const sorted = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const shape = (doc: BoardDoc) => JSON.stringify({ nodes: sorted(doc.nodes), edges: sorted(doc.edges), source: doc.source ?? null });

describe("board undo", () => {
  it("keeps the earlier steps when a save fails", async () => {
    const { vault, board, toast } = await setup();
    await board.commit([{ kind: "place", id: "t", x: 10, y: 10 }]);
    await board.commit([{ kind: "place", id: "t", x: 20, y: 20 }]);
    vi.spyOn(vault, "boardApply").mockRejectedValueOnce(new Error("disk full"));
    expect(await board.commit([{ kind: "place", id: "t", x: 30, y: 30 }])).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(board.store.getState().canUndo).toBe(true);
    await board.undo();
    expect(board.node("t")!.x).toBe(10);
    await board.undo();
    expect(board.node("t")!.x).toBe(400);
  });

  it("does not make a step of a page-map sync batch", async () => {
    const { board } = await setup();
    await board.commit([{ kind: "place", id: "t", x: 10, y: 10 }]);
    await board.commit([{ kind: "text", id: "u", text: "Synced" }], { record: false });
    await board.undo();
    expect(board.node("t")!.x).toBe(400);
    expect(board.node("u")!.text).toBe("Synced");
    expect(board.store.getState().canUndo).toBe(false);
  });

  const CASES: [string, BoardChange[]][] = [
    ["place", [{ kind: "place", id: "t", x: 5, y: 6, width: 300, height: 150 }]],
    ["remove", [{ kind: "remove", ids: ["c", "u"] }]],
    ["text", [{ kind: "text", id: "t", text: "Changed" }]],
    ["color", [{ kind: "color", ids: ["t"], color: "3" }]],
    ["sticky", [{ kind: "sticky", text: "New", x: 900, y: 900 }]],
    ["card", [{ kind: "card", path: "library/b.md", x: 900, y: 900 }]],
    ["link", [{ kind: "link", url: "https://kasten.app", x: 900, y: 900 }]],
    ["section", [{ kind: "section", label: "Sec", x: 900, y: 900, width: 400, height: 300 }]],
    ["wrap", [{ kind: "wrap", ids: ["u"], label: "Wrapped" }]],
    ["connect", [{ kind: "connect", from: "u", to: "t" }]],
    ["edge", [{ kind: "edge", id: "e", label: "then" }]],
    ["unlink", [{ kind: "unlink", ids: ["e"] }]],
    ["card_size", [{ kind: "card_size", id: "c", size: "title" }]],
    ["collapse", [{ kind: "collapse", id: "s", collapsed: true }]],
    ["shape", [{ kind: "shape", shape: "rect", text: "", x: 900, y: 900, width: 100, height: 80 }]],
    ["draw", [{ kind: "draw", points: "0,0 5,5 9,2", x: 900, y: 900, width: 10, height: 10, size: 2 }]],
    ["line", [{ kind: "line", id: "e", dash: true }]],
    ["source", [{ kind: "source", source: { page: "p", root: "c", branches: {} } }]],
  ];

  it.each(CASES)("undoes, redoes and undoes again: %s", async (_name, changes) => {
    const { board } = await setup();
    const before = shape(board.doc);
    await board.commit(changes);
    const after = shape(board.doc);
    expect(after).not.toBe(before);
    await board.undo();
    expect(shape(board.doc)).toBe(before);
    await board.redo();
    expect(shape(board.doc)).toBe(after);
    await board.undo();
    expect(shape(board.doc)).toBe(before);
  });
});
