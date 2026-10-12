import { describe, expect, it } from "vitest";

import { covered, useOcclusion } from "./occlusion";
import { boxOf, isEmpty, overlaps, sameBounds, toPhysical } from "./bounds";
import { createSync } from "./use-bounds";
import type { Bounds } from "./types";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("a placeholder's box in physical pixels", () => {
  it("is the CSS box times the pixel ratio, which has the display's scale and the app's zoom in it", () => {
    expect(toPhysical(box(240, 96, 1040, 696), 1)).toEqual({ x: 240, y: 96, width: 800, height: 600 });
    // A 150% display.
    expect(toPhysical(box(240, 96, 1040, 696), 1.5)).toEqual({ x: 360, y: 144, width: 1200, height: 900 });
    // The app's zoom at 125% on a 150% display multiplies in: 1.875.
    expect(toPhysical(box(240, 96, 1040, 696), 1.5 * 1.25)).toEqual({ x: 450, y: 180, width: 1500, height: 1125 });
    // The app's zoom at 67% on a 100% display.
    expect(toPhysical(box(240, 96, 1040, 696), 0.67)).toEqual({ x: 161, y: 64, width: 536, height: 402 });
  });

  it("rounds the edges, so views side by side meet without a seam or an overlap", () => {
    const left = toPhysical(box(0, 0, 400.4, 300), 1.25);
    const right = toPhysical(box(400.4, 0, 800.8, 300), 1.25);
    expect(left.x + left.width).toBe(right.x);
    expect(right.x + right.width).toBe(Math.round(800.8 * 1.25));
  });

  it("is never empty and never wild, whatever the ratio the page reports", () => {
    expect(toPhysical(box(10, 10, 10, 10), 1)).toEqual({ x: 10, y: 10, width: 1, height: 1 });
    expect(toPhysical(box(10, 10, 110, 60), 0)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(toPhysical(box(10, 10, 110, 60), Number.NaN)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(toPhysical(box(-1e9, 0, 1e9, 10), 2)).toEqual({ x: -32768, y: 0, width: 65536, height: 20 });
    expect(isEmpty(box(0, 0, 0, 50))).toBe(true);
    expect(isEmpty(box(0, 0, 10, 50))).toBe(false);
  });

  it("knows whether two boxes share any area", () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(2, 2, 3, 3))).toBe(true);
    expect(boxOf({ left: 1, top: 2, right: 3, bottom: 4, width: 2 } as DOMRect)).toEqual(box(1, 2, 3, 4));
  });
});

describe("the bounds sync", () => {
  function rig(start = box(0, 0, 100, 100), ratio = 1) {
    const state = { box: start as ReturnType<typeof box> | null, ratio, frames: [] as (() => void)[], sent: [] as Bounds[] };
    const sync = createSync({
      measure: () => state.box,
      ratio: () => state.ratio,
      send: (bounds) => state.sent.push(bounds),
      frame: (run) => state.frames.push(run),
      cancel: () => {},
      burst: 2,
    });
    const tick = () => state.frames.splice(0).forEach((run) => run());
    return { state, sync, tick };
  }

  it("looks once per frame however often it is poked, and sends only what changed", () => {
    const { state, sync, tick } = rig();
    sync.poke();
    sync.poke();
    sync.poke();
    expect(state.frames).toHaveLength(1);
    tick();
    expect(state.sent).toEqual([{ x: 0, y: 0, width: 100, height: 100 }]);
    // The burst looks again twice, and nothing moved: nothing is sent.
    tick();
    tick();
    expect(state.sent).toHaveLength(1);
    expect(state.frames).toHaveLength(0);
  });

  it("follows a layout that settles over several frames", () => {
    const { state, sync, tick } = rig();
    sync.poke();
    tick();
    state.box = box(10, 0, 110, 100);
    sync.poke();
    tick();
    state.box = box(20, 0, 120, 100);
    tick();
    expect(state.sent.map((b) => b.x)).toEqual([0, 10, 20]);
  });

  it("sends again when only the pixel ratio changed (the zoom or the display)", () => {
    const { state, sync, tick } = rig();
    sync.poke();
    tick();
    state.ratio = 1.25;
    sync.poke();
    tick();
    expect(state.sent.at(-1)).toEqual({ x: 0, y: 0, width: 125, height: 125 });
  });

  it("sends nothing for a placeholder that is not shown, and nothing once stopped", () => {
    const { state, sync, tick } = rig(box(0, 0, 0, 0));
    sync.poke();
    tick();
    expect(state.sent).toEqual([]);
    state.box = null;
    sync.poke();
    tick();
    expect(state.sent).toEqual([]);
    state.box = box(0, 0, 50, 50);
    sync.poke();
    sync.stop();
    tick();
    sync.poke();
    expect(state.sent).toEqual([]);
    expect(state.frames).toHaveLength(0);
  });

  it("compares physical rectangles", () => {
    expect(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
    expect(sameBounds(null, null)).toBe(false);
  });
});

describe("the occlusion store", () => {
  const reset = () => useOcclusion.setState({ holds: {} });

  it("hides the view while an overlay overlaps its area, and not for one that does not", () => {
    reset();
    const area = box(200, 100, 800, 600);
    expect(covered(useOcclusion.getState().holds, area)).toBe(false);
    useOcclusion.getState().hold("menu", box(700, 50, 900, 200));
    expect(covered(useOcclusion.getState().holds, area)).toBe(true);
    useOcclusion.getState().hold("menu", box(0, 0, 100, 100));
    expect(covered(useOcclusion.getState().holds, area)).toBe(false);
    useOcclusion.getState().release("menu");
    expect(Object.keys(useOcclusion.getState().holds)).toEqual([]);
  });

  it("treats an overlay that cannot say where it is as covering the window, and keeps each hold apart", () => {
    reset();
    const area = box(200, 100, 800, 600);
    useOcclusion.getState().hold("dialog", "all");
    useOcclusion.getState().hold("menu", box(0, 0, 10, 10));
    expect(covered(useOcclusion.getState().holds, area)).toBe(true);
    useOcclusion.getState().release("dialog");
    expect(covered(useOcclusion.getState().holds, area)).toBe(false);
    useOcclusion.getState().release("nothing");
    expect(Object.keys(useOcclusion.getState().holds)).toEqual(["menu"]);
  });

  it("does not change the store for a hold that is the same", () => {
    reset();
    useOcclusion.getState().hold("menu", box(1, 2, 3, 4));
    const before = useOcclusion.getState().holds;
    useOcclusion.getState().hold("menu", box(1, 2, 3, 4));
    expect(useOcclusion.getState().holds).toBe(before);
    useOcclusion.getState().hold("all", "all");
    const withAll = useOcclusion.getState().holds;
    useOcclusion.getState().hold("all", "all");
    expect(useOcclusion.getState().holds).toBe(withAll);
  });
});
