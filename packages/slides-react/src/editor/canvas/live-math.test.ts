import { describe, expect, it } from "vitest";

import { type Base, EXACT_LIMIT, baseOf, cssOf, lookOf, sizingOf } from "./live-math.ts";

const base: Base = { x: 100, y: 100, w: 200, h: 100, rotation: 0, flipH: false, flipV: false };

describe("what a drag has done to an element", () => {
  it("is nothing when the box is where it was", () => {
    expect(lookOf(base, { x: 100, y: 100, w: 200, h: 100 })).toEqual({ kind: "none" });
  });

  it("is a move when only the place changed, by how far its middle went", () => {
    expect(lookOf(base, { x: 160, y: 140, w: 200, h: 100 })).toEqual({ kind: "move", dx: 60, dy: 40 });
    // A rotation that is the same one the element has is no turn.
    expect(lookOf({ ...base, rotation: 30 }, { x: 110, y: 100, w: 200, h: 100, rotation: 30 })).toEqual({ kind: "move", dx: 10, dy: 0 });
  });

  it("is a turn about the middle when the size is the same and the angle is not", () => {
    expect(lookOf(base, { x: 100, y: 100, w: 200, h: 100, rotation: 45 })).toEqual({ kind: "turn", dx: 0, dy: 0, degrees: 45 });
    // Several things turned together orbit: the middle of one goes about the middle of all.
    expect(lookOf(base, { x: 120, y: 90, w: 200, h: 100, rotation: 10 })).toEqual({ kind: "turn", dx: 20, dy: -10, degrees: 10 });
  });

  it("is a stretch about the middle when the size changed, with the move of the middle", () => {
    // Dragging the right edge out by 100: the middle goes right by 50 and the width doubles-and-a-half.
    expect(lookOf(base, { x: 100, y: 100, w: 300, h: 100 })).toEqual({ kind: "size", dx: 50, dy: 0, sx: 1.5, sy: 1 });
  });

  it("mirrors the stretch when the drag crossed the far edge", () => {
    expect(lookOf(base, { x: 100, y: 100, w: 200, h: 100, flipH: true })).toMatchObject({ kind: "size", sx: -1, sy: 1 });
    expect(lookOf({ ...base, flipV: true }, { x: 100, y: 100, w: 200, h: 100, flipV: false })).toMatchObject({ kind: "size", sy: -1 });
    // The same flip as it has is no mirror.
    expect(lookOf({ ...base, flipH: true }, { x: 100, y: 100, w: 200, h: 100, flipH: true })).toEqual({ kind: "none" });
  });

  it("has nothing to stretch along a side with no length, as a straight line has", () => {
    const line: Base = { ...base, h: 0 };
    expect(lookOf(line, { x: 100, y: 100, w: 300, h: 40 })).toMatchObject({ kind: "size", sx: 1.5, sy: 1 });
  });

  it("reads an element's own box and turn", () => {
    expect(baseOf({ x: 1, y: 2, w: 3, h: 4 }, { rotation: 15, flipH: true })).toEqual({ x: 1, y: 2, w: 3, h: 4, rotation: 15, flipH: true, flipV: false });
    expect(baseOf({ x: 1, y: 2, w: 3, h: 4 }, { rotation: null })).toMatchObject({ rotation: 0, flipH: false });
  });
});

describe("the properties a look is written as", () => {
  it("is a translation, a rotation or a scale, and empty where it does not apply", () => {
    expect(cssOf({ kind: "none" })).toEqual({ translate: "", rotate: "", scale: "" });
    expect(cssOf({ kind: "move", dx: 3, dy: -4 })).toEqual({ translate: "3px -4px", rotate: "", scale: "" });
    expect(cssOf({ kind: "turn", dx: 0, dy: 1, degrees: 30 })).toEqual({ translate: "0px 1px", rotate: "30deg", scale: "" });
    expect(cssOf({ kind: "size", dx: 5, dy: 6, sx: -2, sy: 0.5 })).toEqual({ translate: "5px 6px", rotate: "", scale: "-2 0.5" });
  });
});

describe("how a resize is shown", () => {
  it("draws a few elements again, so their words run on, and stretches many", () => {
    const to = { x: 0, y: 0, w: 10, h: 10 };
    expect(sizingOf(1, base, to, false)).toBe("exact");
    expect(sizingOf(EXACT_LIMIT, base, to, false)).toBe("exact");
    expect(sizingOf(EXACT_LIMIT + 1, base, to, false)).toBe("stretch");
  });

  it("stretches a group, which has no drawing of its own to run again", () => {
    expect(sizingOf(1, base, { x: 0, y: 0, w: 10, h: 10 }, true)).toBe("stretch");
  });

  it("never stretches a turned element, whose own axes are not the screen's", () => {
    expect(sizingOf(EXACT_LIMIT + 1, { ...base, rotation: 20 }, { x: 0, y: 0, w: 10, h: 10, rotation: 20 }, false)).toBe("exact");
  });
});
