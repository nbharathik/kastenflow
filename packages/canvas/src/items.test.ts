import { describe, expect, it } from "vitest";

import { boundsOf, hitStack, hitTest, selectionBounds } from "./items.ts";
import type { Item } from "./items.ts";

const a: Item = { id: "a", x: 0, y: 0, w: 100, h: 50 };
const b: Item = { id: "b", x: 50, y: 25, w: 100, h: 50 };
// Turned a quarter, 200 x 100 at (100, 100) fills x 150..250, y 50..250 around the centre (200, 150).
const turned: Item = { id: "t", x: 100, y: 100, w: 200, h: 100, rotation: 90 };
// A diamond: a 100 x 100 square turned 45 degrees about (50, 50).
const diamond: Item = { id: "d", x: 0, y: 0, w: 100, h: 100, rotation: 45 };

describe("selectionBounds", () => {
  it.each([
    ["one item", [a, b], ["a"], { x: 0, y: 0, w: 100, h: 50 }],
    ["two items", [a, b], ["a", "b"], { x: 0, y: 0, w: 150, h: 75 }],
    ["ids in any order", [a, b], ["b", "a"], { x: 0, y: 0, w: 150, h: 75 }],
    ["a quarter-turned item by its turned box", [turned], ["t"], { x: 150, y: 50, w: 100, h: 200 }],
    ["turned and upright together", [a, turned], ["a", "t"], { x: 0, y: 0, w: 250, h: 250 }],
    ["only the chosen ones", [a, b, turned], ["b"], { x: 50, y: 25, w: 100, h: 50 }],
  ])("holds %s", (_name, items, ids, expected) => {
    expect(selectionBounds(items, ids)).toEqual(expected);
  });

  it("is null when nothing is chosen or nothing matches", () => {
    expect(selectionBounds([a, b], [])).toBeNull();
    expect(selectionBounds([a, b], ["nope"])).toBeNull();
    expect(selectionBounds([], ["a"])).toBeNull();
  });

  it("holds a diamond by the corners it sticks out to", () => {
    const r = selectionBounds([diamond], ["d"]);
    // Half the diagonal is 50 * sqrt(2) = 70.7107 either side of the centre (50, 50).
    expect(r?.x).toBeCloseTo(50 - 50 * Math.SQRT2, 9);
    expect(r?.y).toBeCloseTo(50 - 50 * Math.SQRT2, 9);
    expect(r?.w).toBeCloseTo(100 * Math.SQRT2, 9);
    expect(r?.h).toBeCloseTo(100 * Math.SQRT2, 9);
  });

  it("accepts any iterable of ids", () => {
    expect(selectionBounds([a, b], new Set(["a"]))).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it("gives an upright item's own box from boundsOf", () => {
    expect(boundsOf(a)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(boundsOf(turned)).toEqual({ x: 150, y: 50, w: 100, h: 200 });
  });
});

describe("hitTest", () => {
  it.each([
    ["the topmost of two overlapping items", { x: 75, y: 40 }, "b"],
    ["the lower one where the upper does not reach", { x: 10, y: 10 }, "a"],
    ["nothing on empty canvas", { x: 400, y: 400 }, null],
    ["a corner exactly", { x: 0, y: 0 }, "a"],
    ["the far edge exactly", { x: 150, y: 75 }, "b"],
    ["nothing just outside", { x: 150.5, y: 75 }, null],
  ])("finds %s", (_name, point, expected) => {
    expect(hitTest([a, b], point, {})).toBe(expected);
  });

  it("puts the last item in the array on top", () => {
    expect(hitTest([b, a], { x: 75, y: 40 })).toBe("a");
  });

  it("returns null for no items", () => {
    expect(hitTest([], { x: 0, y: 0 })).toBeNull();
  });

  describe("turned items", () => {
    it("hits where the turned box is, not where the unturned one was", () => {
      // Inside the turned shape (x 150..250, y 50..250) but above the unturned box (y 100..200).
      expect(hitTest([turned], { x: 200, y: 60 })).toBe("t");
      // Inside the unturned box (x 100..300) but left of the turned shape.
      expect(hitTest([turned], { x: 120, y: 120 })).toBeNull();
    });

    it("misses the corners of a diamond that its upright box would catch", () => {
      expect(hitTest([diamond], { x: 5, y: 5 })).toBeNull();
      expect(hitTest([diamond], { x: 50, y: 5 })).toBe("d");
      expect(hitTest([diamond], { x: 50, y: 50 })).toBe("d");
      // The left tip is at (-20.7, 50): a point left of the square is still on the diamond...
      expect(hitTest([diamond], { x: -10, y: 50 })).toBe("d");
      // ...but 20 units higher it is off the slanting edge, though inside the upright bounds.
      expect(hitTest([diamond], { x: -10, y: 30 })).toBeNull();
    });

    // A square or a quarter turn looks the same turned either way, so only a longer box at another angle
    // can tell that the point is turned back by the rotation and not on by it.
    describe("a long box turned 30 degrees", () => {
      const cos = Math.sqrt(3) / 2;
      // Its own x axis points down and right, (cos 30, sin 30), and its y axis (-sin 30, cos 30) down and left.
      const at = (along: number, across = 0) => ({ x: 200 + along * cos - across * 0.5, y: 150 + along * 0.5 + across * cos });

      it.each([30, 390, -330])("is where its axes are, at a rotation of %d", (rotation) => {
        const long: Item = { id: "long", x: 100, y: 100, w: 200, h: 100, rotation };
        expect(hitTest([long], at(99))).toBe("long");
        expect(hitTest([long], at(101))).toBeNull();
        expect(hitTest([long], at(-99))).toBe("long");
        expect(hitTest([long], at(0, 49))).toBe("long");
        expect(hitTest([long], at(0, 51))).toBeNull();
        expect(hitTest([long], at(90, 45))).toBe("long");
        expect(hitTest([long], at(90, 55))).toBeNull();
      });

      it("is not where the same turn the other way would put it", () => {
        const long: Item = { id: "long", x: 100, y: 100, w: 200, h: 100, rotation: 30 };
        // 90 along the box leaning up and right, instead, is far off it.
        expect(hitTest([long], { x: 200 + 90 * cos, y: 150 - 45 })).toBeNull();
        const other: Item = { ...long, rotation: -30 };
        expect(hitTest([other], { x: 200 + 90 * cos, y: 150 - 45 })).toBe("long");
        expect(hitTest([other], at(90))).toBeNull();
      });
    });

    it("orders a turned item against an upright one by array position", () => {
      const backdrop: Item = { id: "back", x: 0, y: 0, w: 400, h: 300 };
      expect(hitTest([backdrop, turned], { x: 200, y: 60 })).toBe("t");
      expect(hitTest([turned, backdrop], { x: 200, y: 60 })).toBe("back");
      // Left of the turned shape only the backdrop is there.
      expect(hitTest([backdrop, turned], { x: 120, y: 120 })).toBe("back");
    });
  });

  describe("locked items", () => {
    const locked: Item = { ...b, locked: true };

    it("are skipped, so the one beneath is hit", () => {
      expect(hitTest([a, locked], { x: 75, y: 40 })).toBe("a");
      expect(hitTest([locked], { x: 75, y: 40 })).toBeNull();
    });

    it("are hit when asked for", () => {
      expect(hitTest([a, locked], { x: 75, y: 40 }, { includeLocked: true })).toBe("b");
    });
  });

  describe("tolerance", () => {
    const box: Item = { id: "x", x: 100, y: 100, w: 50, h: 50 };

    it.each([
      [{ x: 98, y: 120 }, 0, null],
      [{ x: 98, y: 120 }, 3, "x"],
      [{ x: 97, y: 120 }, 3, "x"],
      [{ x: 96.9, y: 120 }, 3, null],
      [{ x: 120, y: 152.9 }, 3, "x"],
      [{ x: 120, y: 153.1 }, 3, null],
      [{ x: 153, y: 153 }, 3, "x"],
    ])("grows the box: %o by %d", (point, tolerance, expected) => {
      expect(hitTest([box], point, { tolerance })).toBe(expected);
    });

    it("treats a negative tolerance as none: it neither shrinks nor grows the box", () => {
      expect(hitTest([box], { x: 101, y: 120 }, { tolerance: -10 })).toBe("x");
      expect(hitTest([box], { x: 99, y: 120 }, { tolerance: -10 })).toBeNull();
    });
  });

  describe("thin items", () => {
    const line: Item = { id: "line", x: 0, y: 100, w: 200, h: 0 };
    const rule: Item = { id: "rule", x: 100, y: 0, w: 0, h: 200 };
    const four: Item = { id: "four", x: 0, y: 100, w: 200, h: 4 };
    const wide: Item = { id: "wide", x: 0, y: 100, w: 200, h: 10 };

    it.each([
      ["a horizontal line, 3 above", line, { x: 50, y: 97 }, "line"],
      ["a horizontal line, 3 below", line, { x: 50, y: 103 }, "line"],
      ["a horizontal line, just past the band", line, { x: 50, y: 103.1 }, null],
      ["a horizontal line's end", line, { x: 200, y: 100 }, "line"],
      ["a horizontal line, past its end", line, { x: 203.5, y: 100 }, null],
      ["a vertical line, 3 to the side", rule, { x: 103, y: 50 }, "rule"],
      ["a vertical line, past the band", rule, { x: 96.9, y: 50 }, null],
      ["a 4 unit band, 1 above", four, { x: 50, y: 99 }, "four"],
      ["a 4 unit band, 1 below", four, { x: 50, y: 105 }, "four"],
      ["a 4 unit band, past 1", four, { x: 50, y: 105.1 }, null],
      ["a 10 unit box is not widened", wide, { x: 50, y: 98.5 }, null],
    ])("gives %s a 6 unit band", (_name, item, point, expected) => {
      expect(hitTest([item], point)).toBe(expected);
    });

    it("turns the band with the line", () => {
      // The horizontal line turned a quarter is a vertical line through x = 100, y 0..200.
      const upright: Item = { ...line, rotation: 90 };
      expect(hitTest([upright], { x: 102, y: 50 })).toBe("line");
      expect(hitTest([upright], { x: 104, y: 50 })).toBeNull();
      expect(hitTest([upright], { x: 50, y: 100 })).toBeNull();
    });

    it("adds the tolerance to the band", () => {
      expect(hitTest([line], { x: 50, y: 104.9 }, { tolerance: 2 })).toBe("line");
      expect(hitTest([line], { x: 50, y: 105.1 }, { tolerance: 2 })).toBeNull();
    });
  });

  describe("a line with a path", () => {
    // A diagonal from the top left to the bottom right of a 200 x 200 box.
    const diagonal: Item = { id: "d", x: 0, y: 0, w: 200, h: 200, path: [{ x: 0, y: 0 }, { x: 200, y: 200 }] };

    it("is hit near its path and not in the empty corners of its box", () => {
      expect(hitTest([diagonal], { x: 100, y: 102 })).toBe("d");
      expect(hitTest([diagonal], { x: 100, y: 110 })).toBeNull();
      expect(hitTest([diagonal], { x: 180, y: 20 })).toBeNull();
      expect(hitTest([diagonal], { x: 0, y: 0 })).toBe("d");
    });

    it("follows a bent path", () => {
      const bent: Item = { ...diagonal, path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 200, y: 200 }] };
      expect(hitTest([bent], { x: 100, y: 120 })).toBe("d");
      expect(hitTest([bent], { x: 50, y: 50 })).toBeNull();
    });

    it("grows with the tolerance and turns with the item", () => {
      expect(hitTest([diagonal], { x: 100, y: 108 }, { tolerance: 4 })).toBe("d");
      const quarter: Item = { ...diagonal, rotation: 90 };
      // Turned a quarter about (100, 100) the diagonal runs from the top right to the bottom left.
      expect(hitTest([quarter], { x: 100, y: 102 })).toBe("d");
      expect(hitTest([quarter], { x: 20, y: 20 })).toBeNull();
      expect(hitTest([quarter], { x: 180, y: 20 })).toBe("d");
    });
  });

  describe("hitStack", () => {
    it("lists every item under the point, topmost first, honouring locks", () => {
      const back: Item = { id: "back", x: 0, y: 0, w: 100, h: 100 };
      const middle: Item = { id: "middle", x: 0, y: 0, w: 100, h: 100, locked: true };
      const front: Item = { id: "front", x: 0, y: 0, w: 100, h: 100 };
      expect(hitStack([back, middle, front], { x: 50, y: 50 })).toEqual(["front", "back"]);
      expect(hitStack([back, middle, front], { x: 50, y: 50 }, { includeLocked: true })).toEqual(["front", "middle", "back"]);
      expect(hitStack([back], { x: 500, y: 500 })).toEqual([]);
    });
  });
});
