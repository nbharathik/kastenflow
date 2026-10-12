import { beforeEach, describe, expect, it, vi } from "vitest";

import { Places, idHash } from "./places";

beforeEach(() => localStorage.clear());

describe("where the graph's nodes were left", () => {
  it("gives a node the same number every time, and different nodes different ones", () => {
    expect(idHash("a.md")).toBe(idHash("a.md"));
    expect(idHash("a.md")).not.toBe(idHash("b.md"));
    expect(Number.isInteger(idHash("projects/x/pages/y.md"))).toBe(true);
  });

  it("knows the places it was told and leaves the others to the layout", () => {
    const places = new Places("vault");
    places.remember(["a", "b"], [1.26, 2.34, -5, 7]);
    const { start, known } = places.start(["b", "new", "a"]);
    expect(known).toBe(2);
    expect(Array.from(start.slice(0, 2))).toEqual([-5, 7]);
    expect(Number.isNaN(start[2])).toBe(true);
    expect(Number.isNaN(start[3])).toBe(true);
    expect(Array.from(start.slice(4))).toEqual([1.26, 2.34]);
  });

  it("keeps places in storage per scope, rounded, for the next window", () => {
    const places = new Places("project:x");
    places.remember(["a", "b"], [1.26, 2.34, -5, 7]);
    places.save();
    const next = new Places("project:x");
    expect(Array.from(next.start(["a", "b"]).start)).toEqual([1.3, 2.3, -5, 7]);
    // Another scope starts with none.
    expect(new Places("vault").start(["a"]).known).toBe(0);
    next.switchTo("vault");
    expect(next.start(["a"]).known).toBe(0);
    next.switchTo("project:x");
    expect(next.start(["a"]).known).toBe(1);
  });

  it("keeps only the scopes used last", () => {
    for (let n = 0; n < 12; n++) {
      const places = new Places(`scope-${n}`);
      places.remember(["a"], [n, n]);
      places.save();
    }
    expect(new Places("scope-0").start(["a"]).known).toBe(0);
    expect(new Places("scope-3").start(["a"]).known).toBe(0);
    expect(new Places("scope-4").start(["a"]).known).toBe(1);
    expect(new Places("scope-11").start(["a"]).known).toBe(1);
  });

  it("starts empty when storage holds nonsense or refuses", () => {
    localStorage.setItem("kasten.graph.places:vault", "{not json");
    expect(new Places("vault").start(["a"]).known).toBe(0);
    localStorage.setItem("kasten.graph.places:vault", JSON.stringify({ k: [idHash("a")], p: ["x", null] }));
    expect(new Places("vault").start(["a"]).known).toBe(0);
    const places = new Places("vault");
    places.remember(["a"], [1, 1]);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => places.save()).not.toThrow();
    set.mockRestore();
  });

  it("does not remember a node with no place", () => {
    const places = new Places("vault");
    places.remember(["a", "b"], [Number.NaN, 0, 3, 4]);
    expect(places.start(["a", "b"]).known).toBe(1);
  });
});
