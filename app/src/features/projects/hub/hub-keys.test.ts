import { describe, expect, it } from "vitest";

import { columnsFor, nextIndex } from "./hub-keys";

describe("moving between cards with the arrow keys", () => {
  // Seven cards in rows of three: 0 1 2 / 3 4 5 / 6.
  const go = (key: string, from: number, columns = 3, count = 7) => nextIndex(key, from, count, columns, 2);

  it("goes along a row with left and right, and stops at the ends", () => {
    expect(go("ArrowRight", 1)).toBe(2);
    expect(go("ArrowLeft", 1)).toBe(0);
    expect(go("ArrowLeft", 0)).toBe(0);
    expect(go("ArrowRight", 6)).toBe(6);
  });

  it("goes down and up a column", () => {
    expect(go("ArrowDown", 1)).toBe(4);
    expect(go("ArrowUp", 4)).toBe(1);
    expect(go("ArrowUp", 1)).toBe(1);
  });

  it("goes to the last card from under a short last row, and stays on the last row", () => {
    expect(go("ArrowDown", 4)).toBe(6);
    expect(go("ArrowDown", 5)).toBe(6);
    expect(go("ArrowDown", 6)).toBe(6);
  });

  it("goes to the first and the last, and a page at a time", () => {
    expect(go("Home", 5)).toBe(0);
    expect(go("End", 1)).toBe(6);
    expect(nextIndex("PageDown", 0, 40, 4, 3)).toBe(12);
    expect(nextIndex("PageUp", 14, 40, 4, 3)).toBe(2);
    expect(nextIndex("PageDown", 38, 40, 4, 3)).toBe(39);
  });

  it("is a column of rows when there is one column", () => {
    expect(go("ArrowDown", 2, 1)).toBe(3);
    expect(go("ArrowUp", 2, 1)).toBe(1);
  });

  it("leaves other keys alone, and an empty list too", () => {
    expect(go("a", 1)).toBeNull();
    expect(nextIndex("ArrowDown", 0, 0, 1, 1)).toBeNull();
  });
});

describe("how many cards are in a row", () => {
  it("counts the columns the grid is laid out in", () => {
    expect(columnsFor("272px 272px 272px", 900)).toBe(3);
    expect(columnsFor("272.5px 272.5px", 900)).toBe(2);
    expect(columnsFor("", 0)).toBe(1);
  });

  it("falls back to the width and the smallest card when the grid says nothing", () => {
    expect(columnsFor("none", 848)).toBe(3);
    // 3 cards of 272px and 2 gaps of 16px fit 848px; 4 would need 1136px.
    expect(columnsFor("", 848)).toBe(3);
    expect(columnsFor("", 1135)).toBe(3);
    expect(columnsFor("", 1136)).toBe(4);
    expect(columnsFor("", 200)).toBe(1);
  });
});
