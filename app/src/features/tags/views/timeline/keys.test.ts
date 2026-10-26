import { describe, expect, it } from "vitest";

import { actionOf, neighbour, type Rows } from "./keys";

const key = (k: string, mods: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key: k, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...mods });

describe("timeline keys", () => {
  it("reads arrows as moving focus and Alt+arrows as shifting a day", () => {
    expect(actionOf(key("ArrowRight"))).toEqual({ kind: "focus", step: "right" });
    expect(actionOf(key("ArrowUp"))).toEqual({ kind: "focus", step: "up" });
    expect(actionOf(key("Home"))).toEqual({ kind: "focus", step: "first" });
    expect(actionOf(key("ArrowLeft", { altKey: true }))).toEqual({ kind: "shift", grip: "move", days: -1 });
    expect(actionOf(key("ArrowRight", { altKey: true }))).toEqual({ kind: "shift", grip: "move", days: 1 });
    expect(actionOf(key("ArrowRight", { altKey: true, shiftKey: true }))).toEqual({ kind: "shift", grip: "end", days: 1 });
    expect(actionOf(key("Enter"))).toEqual({ kind: "open" });
  });

  it("leaves other keys and shortcuts alone", () => {
    expect(actionOf(key("a"))).toBeNull();
    expect(actionOf(key("ArrowUp", { altKey: true }))).toBeNull();
    expect(actionOf(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(actionOf(key("ArrowRight", { metaKey: true, altKey: true }))).toBeNull();
    expect(actionOf(key("Enter", { altKey: true }))).toBeNull();
    expect(actionOf(key("ArrowDown", { shiftKey: true }))).toBeNull();
  });
});

describe("timeline focus", () => {
  const rows: Rows = [
    [
      { id: "a", centre: 10 },
      { id: "b", centre: 100 },
    ],
    [],
    [
      { id: "c", centre: 20 },
      { id: "d", centre: 90 },
      { id: "e", centre: 300 },
    ],
  ];

  it("goes along a row and stops at its ends", () => {
    expect(neighbour(rows, "a", "right")).toBe("b");
    expect(neighbour(rows, "b", "right")).toBe("b");
    expect(neighbour(rows, "d", "left")).toBe("c");
    expect(neighbour(rows, "c", "left")).toBe("c");
    expect(neighbour(rows, "c", "last")).toBe("e");
    expect(neighbour(rows, "e", "first")).toBe("c");
  });

  it("goes to the nearest bar in the next row up or down, passing empty rows", () => {
    expect(neighbour(rows, "b", "down")).toBe("d");
    expect(neighbour(rows, "a", "down")).toBe("c");
    expect(neighbour(rows, "e", "up")).toBe("b");
    expect(neighbour(rows, "c", "up")).toBe("a");
    expect(neighbour(rows, "a", "up")).toBe("a");
    expect(neighbour(rows, "e", "down")).toBe("e");
  });

  it("knows no bar it was not given", () => {
    expect(neighbour(rows, "zzz", "right")).toBeNull();
    expect(neighbour([], "a", "down")).toBeNull();
  });
});
