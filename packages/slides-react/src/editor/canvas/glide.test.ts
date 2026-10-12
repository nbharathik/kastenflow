import { describe, expect, it } from "vitest";

import { glideElements, offsetOf, shortTurn } from "./glide.ts";

const spot = (x: number, y: number, w = 100, h = 50, rotation = 0) => ({ x, y, w, h, rotation });

describe("the short way round", () => {
  it("is the smaller turn between two angles, either way", () => {
    expect(shortTurn(10, 350)).toBe(20);
    expect(shortTurn(350, 10)).toBe(-20);
    expect(shortTurn(90, 0)).toBe(90);
    expect(shortTurn(0, 0)).toBe(0);
    expect(Math.abs(shortTurn(180, 0))).toBe(180);
  });
});

describe("how far an element is from where it was", () => {
  it("is nothing for an element that did not move, or moved less than the eye can see", () => {
    expect(offsetOf(spot(10, 10), spot(10, 10))).toBeNull();
    expect(offsetOf(spot(10, 10), spot(10.2, 10.1))).toBeNull();
  });

  it("is the move of its middle, from where it is now back to where it was", () => {
    expect(offsetOf(spot(100, 100), spot(160, 140))).toMatchObject({ dx: -60, dy: -40, sx: 1, sy: 1, turn: 0 });
  });

  it("scales about the middle for a size, and turns the short way", () => {
    // Twice as wide now as it was: it was half the size, and its middle was at the same place.
    expect(offsetOf(spot(100, 100, 100, 50), spot(50, 100, 200, 50))).toMatchObject({ dx: 0, dy: 0, sx: 0.5, sy: 1 });
    expect(offsetOf(spot(0, 0, 10, 10, 350), spot(0, 0, 10, 10, 10))?.turn).toBe(-20);
  });

  it("does not divide by a side with no length", () => {
    expect(offsetOf(spot(0, 0, 10, 0), spot(0, 0, 10, 0))).toBeNull();
    expect(offsetOf(spot(0, 0, 10, 0), spot(20, 0, 10, 0))).toMatchObject({ sy: 1, dx: -20 });
  });
});

describe("gliding the elements of a change", () => {
  it("starts nothing where there is no motion to play (a page that cannot animate)", () => {
    const root = document.createElement("div");
    const node = document.createElement("div");
    node.dataset.el = "a";
    root.append(node);
    const was = new Map([["a", spot(0, 0)]]);
    const now = new Map([["a", spot(100, 0)]]);
    expect(glideElements(root, null, was, now, 1)).toBe(0);
  });

  it("starts one for each element that moved, with the page's animations", () => {
    const root = document.createElement("div");
    const animated: { node: string; keyframes: Keyframe[] }[] = [];
    for (const id of ["a", "b"]) {
      const node = document.createElement("div");
      node.dataset.el = id;
      Object.assign(node, {
        animate: (keyframes: Keyframe[]) => {
          animated.push({ node: id, keyframes });
          return { cancel() {} };
        },
      });
      root.append(node);
    }
    document.documentElement.dataset.motion = "on";
    try {
      const was = new Map([["a", spot(0, 0)], ["b", spot(5, 5)]]);
      const now = new Map([["a", spot(100, 0)], ["b", spot(5, 5)]]);
      expect(glideElements(root, null, was, now, 1)).toBe(1);
      expect(animated).toHaveLength(1);
      expect(animated[0]).toMatchObject({ node: "a" });
      expect(animated[0]!.keyframes[0]).toMatchObject({ translate: "-100px 0px" });
      expect(animated[0]!.keyframes[1]).toMatchObject({ translate: "0 0" });
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });
});
