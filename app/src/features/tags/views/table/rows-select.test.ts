import { describe, expect, it } from "vitest";

import { extend, groupState, NOTHING, rangeTo, selectAll, setGroup, toggleRow, visibleOf, type Picked } from "./rows-select";

const order = ["a", "b", "c", "d", "e", "f"];
const set = (p: Picked) => [...p.paths].sort();

describe("toggling rows", () => {
  it("adds a row, takes it off again, and remembers the last one as the anchor", () => {
    const one = toggleRow(NOTHING, "b");
    expect(set(one)).toEqual(["b"]);
    expect(one.anchor).toBe("b");
    const two = toggleRow(one, "d");
    expect(set(two)).toEqual(["b", "d"]);
    expect(set(toggleRow(two, "b"))).toEqual(["d"]);
  });

  it("never changes the selection it was given", () => {
    const one = toggleRow(NOTHING, "a");
    toggleRow(one, "b");
    expect(set(one)).toEqual(["a"]);
    expect(NOTHING.paths.size).toBe(0);
  });
});

describe("Shift-click ranges", () => {
  it("selects everything from the anchor to the row clicked, either way", () => {
    const start = toggleRow(NOTHING, "b");
    expect(set(rangeTo(start, order, "e"))).toEqual(["b", "c", "d", "e"]);
    expect(set(rangeTo(start, order, "a"))).toEqual(["a", "b"]);
  });

  it("gives the whole range the anchor's state, so a ranged deselect works", () => {
    let p = rangeTo(toggleRow(NOTHING, "a"), order, "f");
    expect(p.paths.size).toBe(6);
    p = toggleRow(p, "b"); // the anchor is now b, which is off
    expect(set(rangeTo(p, order, "d"))).toEqual(["a", "e", "f"]);
  });

  it("only toggles the row when there is no anchor, or the anchor left the table", () => {
    expect(set(rangeTo(NOTHING, order, "c"))).toEqual(["c"]);
    const gone = { paths: new Set(["x"]), anchor: "x", head: "x" };
    expect(set(rangeTo(gone, order, "c"))).toEqual(["c", "x"]);
  });

  it("moves the anchor to the row clicked, so the next range starts there", () => {
    const p = rangeTo(toggleRow(NOTHING, "a"), order, "c");
    expect(p.anchor).toBe("c");
  });
});

describe("select all in a group", () => {
  const group = ["b", "c", "d"];

  it("selects the group's rows, keeping the others", () => {
    const p = setGroup(toggleRow(NOTHING, "f"), group);
    expect(set(p)).toEqual(["b", "c", "d", "f"]);
  });

  it("takes the whole group off when every row of it is already picked", () => {
    const all = setGroup(toggleRow(NOTHING, "f"), group);
    expect(set(setGroup(all, group))).toEqual(["f"]);
  });

  it("finishes a half-picked group instead of clearing it", () => {
    const some = toggleRow(NOTHING, "c");
    expect(set(setGroup(some, group))).toEqual(["b", "c", "d"]);
  });

  it("says whether a group is none, some or all picked", () => {
    expect(groupState(NOTHING, group)).toBe("none");
    expect(groupState(toggleRow(NOTHING, "c"), group)).toBe("some");
    expect(groupState(setGroup(NOTHING, group), group)).toBe("all");
    expect(groupState(NOTHING, [])).toBe("none");
  });
});

describe("Shift+arrows", () => {
  it("starts a run at the active row and grows it one row at a time", () => {
    let p = extend(NOTHING, order, "b", 1);
    expect(set(p)).toEqual(["b", "c"]);
    p = extend(p, order, "c", 1);
    expect(set(p)).toEqual(["b", "c", "d"]);
  });

  it("shrinks when it comes back toward the anchor", () => {
    let p = extend(extend(NOTHING, order, "b", 1), order, "c", 1);
    p = extend(p, order, "d", -1);
    expect(set(p)).toEqual(["b", "c"]);
    p = extend(p, order, "c", -1);
    expect(set(p)).toEqual(["b"]);
  });

  it("grows upward from the anchor too", () => {
    const p = extend(extend(NOTHING, order, "d", -1), order, "c", -1);
    expect(set(p)).toEqual(["b", "c", "d"]);
  });

  it("keeps rows picked earlier when it starts a new run elsewhere", () => {
    const p = extend(toggleRow(NOTHING, "a"), order, "d", 1);
    expect(set(p)).toEqual(["a", "d", "e"]);
  });

  it("stays put at either end of the table", () => {
    expect(set(extend(NOTHING, order, "f", 1))).toEqual(["f"]);
    expect(set(extend(NOTHING, order, "a", -1))).toEqual(["a"]);
  });

  it("ignores a row that is not in the table", () => {
    expect(extend(NOTHING, order, "zzz", 1)).toBe(NOTHING);
  });
});

describe("what the bar acts on", () => {
  it("lists the picked rows in table order and leaves out rows no longer shown", () => {
    const p = { paths: new Set(["d", "gone", "b"]), anchor: "b", head: "b" };
    expect(visibleOf(p, order)).toEqual(["b", "d"]);
  });

  it("selects every row", () => {
    expect(set(selectAll(order))).toEqual(order);
    expect(selectAll([]).paths.size).toBe(0);
  });
});
