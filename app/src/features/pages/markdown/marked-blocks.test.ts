import { describe, expect, it } from "vitest";

import type { Snapshot } from "./codec";
import { loadedBlocks, markedBlocks } from "./marked-blocks";

// "# Title\n\nOne\ntwo\n\n\n- a\n- b\n- c\n": a heading on line 0, a
// paragraph on lines 2 and 3, a list on lines 6 to 8.
const SNAPSHOT: Snapshot<string> = {
  units: [
    { gap: "", src: "# Title", nodes: ["H:Title"] },
    { gap: "\n\n", src: "One\ntwo", nodes: ["P:One two"] },
    { gap: "\n\n\n", src: "- a\n- b\n- c", nodes: ["L:a", "L:b"] },
  ],
  tail: "\n",
  eol: "\n",
  context: "",
};
const LOADED = ["H:Title", "P:One two", "L:a", "L:b"];
const eq = (a: string, b: string) => a === b;
const mark = (start: number, end: number, time = 1) => ({ start, end, time });

describe("agent marks on blocks", () => {
  it("finds the lines each block was loaded from", () => {
    expect(loadedBlocks(SNAPSHOT).map((b) => [b.start, b.end])).toEqual([
      [0, 1],
      [2, 4],
      [6, 9],
    ]);
    const crlf = { ...SNAPSHOT, units: SNAPSHOT.units.map((u) => ({ ...u, gap: u.gap.replace(/\n/g, "\r\n"), src: u.src.replace(/\n/g, "\r\n") })) };
    expect(loadedBlocks(crlf).map((b) => b.start)).toEqual([0, 2, 6]);
  });

  it("marks the blocks over marked lines, with a badge on the first of each mark", () => {
    const m = mark(2, 9);
    expect(markedBlocks(loadedBlocks(SNAPSHOT), [m], LOADED, eq)).toEqual([
      { from: 1, to: 2, badge: m, time: 1 },
      { from: 2, to: 4, badge: null, time: 1 },
    ]);
    // Blank lines alone belong to no block.
    expect(markedBlocks(loadedBlocks(SNAPSHOT), [mark(4, 6)], LOADED, eq)).toEqual([]);
  });

  it("drops the mark of a block edited since the load, and follows the others", () => {
    const m = mark(2, 9);
    const edited = ["H:Title", "P:One two!", "L:a", "L:b"];
    expect(markedBlocks(loadedBlocks(SNAPSHOT), [m], edited, eq)).toEqual([{ from: 2, to: 4, badge: m, time: 1 }]);
    const added = ["P:new", "H:Title", "P:One two", "L:a", "L:b"];
    expect(markedBlocks(loadedBlocks(SNAPSHOT), [m], added, eq).map((b) => b.from)).toEqual([2, 3]);
    // A block that lost one of its nodes counts as edited.
    const shorter = ["H:Title", "P:One two", "L:a"];
    expect(markedBlocks(loadedBlocks(SNAPSHOT), [m], shorter, eq)).toEqual([{ from: 1, to: 2, badge: m, time: 1 }]);
  });

  it("tells when the newest mark over a block was written", () => {
    const found = markedBlocks(loadedBlocks(SNAPSHOT), [mark(0, 4, 5), mark(2, 3, 9), mark(6, 7, 2)], LOADED, eq);
    expect(found.map((b) => b.time)).toEqual([5, 9, 2]);
  });

  it("gives each mark its own badge, the newest where two start together", () => {
    const [older, newer, list] = [mark(0, 1, 1), mark(0, 4, 5), mark(6, 7, 2)];
    const found = markedBlocks(loadedBlocks(SNAPSHOT), [older, newer, list], LOADED, eq);
    expect(found.map((b) => b.badge)).toEqual([newer, null, list]);
    expect(markedBlocks(loadedBlocks(SNAPSHOT), [], LOADED, eq)).toEqual([]);
  });
});
