import { describe, expect, it } from "vitest";

import { anchorAt, columnHeight, pageBoxes, pagesInView, scrollFor } from "./anchor";

const sizes = (n: number, height = 800) => Array.from({ length: n }, () => ({ width: 600, height }));

describe("the reader's place in a column of pages", () => {
  const boxes = pageBoxes(sizes(5), 1, 12, 12);

  it("lays pages out with a gap and padding", () => {
    expect(boxes.map((b) => b.top)).toEqual([12, 824, 1636, 2448, 3260]);
    expect(columnHeight(boxes, 12)).toBe(4072);
  });

  it("finds page and ratio, and goes back to the same place", () => {
    const at = anchorAt(824 + 400, boxes);
    expect(at.page).toBe(1);
    expect(at.ratio).toBeCloseTo(0.5);
    expect(scrollFor(at, boxes)).toBe(1224);
  });

  it("survives a zoom: same page and ratio at another scale", () => {
    const at = anchorAt(1636 + 200, boxes);
    const zoomed = pageBoxes(sizes(5), 2, 12, 12);
    expect(scrollFor(at, zoomed)).toBe(zoomed[2]!.top + 0.25 * zoomed[2]!.height);
  });

  it("before the first page and in a gap are the edges of the nearest page", () => {
    expect(anchorAt(0, boxes)).toEqual({ page: 0, ratio: 0 });
    expect(anchorAt(815, boxes).ratio).toBe(1);
  });

  it("a PDF that got shorter puts the reader at the end, an empty one at the top", () => {
    const short = pageBoxes(sizes(2), 1, 12, 12);
    expect(scrollFor({ page: 4, ratio: 0.3 }, short)).toBe(short[1]!.top + short[1]!.height);
    expect(scrollFor({ page: 1, ratio: 0.3 }, [])).toBe(0);
    expect(anchorAt(500, [])).toEqual({ page: 0, ratio: 0 });
  });

  it("lists the pages in a window, with a margin", () => {
    expect(pagesInView(0, 800, boxes)).toEqual([0]);
    expect(pagesInView(0, 800, boxes, 1)).toEqual([0, 1]);
    expect(pagesInView(1700, 600, boxes, 1)).toEqual([1, 2, 3]);
    expect(pagesInView(99999, 800, boxes, 1)).toEqual([]);
  });
});
