import type { Guide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { inchesText, rulerTicks, stepAt, unitAt } from "./ruler.ts";
import { addedGuide, movedGuide, snapAidsOf } from "./snap-aids.ts";

describe("the marks of a ruler", () => {
  it("are finer the more the slide is magnified, and never crowd", () => {
    expect(stepAt(0.25)).toBe(48);
    expect(stepAt(1)).toBe(12);
    expect(stepAt(0.01)).toBe(480);
  });

  it("number every whole inch and mark the fractions between", () => {
    const ticks = rulerTicks(192, 1);
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["0", "1", "2"]);
    expect(ticks.some((t) => t.at === 48 && !t.major)).toBe(true);
    expect(ticks.find((t) => t.at === 48)?.label).toBeUndefined();
  });

  it("say inches", () => {
    expect(inchesText(96)).toBe("1");
    expect(inchesText(48)).toBe("0.5");
    expect(inchesText(960)).toBe("10");
  });

  it("are none for an empty ruler", () => {
    expect(rulerTicks(0, 1)).toEqual([]);
    expect(rulerTicks(100, 0)).toEqual([]);
  });

  it("turn a pointer into a place on the slide", () => {
    expect(unitAt(300, 100, 0.5)).toBe(400);
  });
});

describe("the guides", () => {
  const lines: Guide[] = [
    { axis: "vertical", at: 100 },
    { axis: "horizontal", at: 50 },
    { axis: "vertical", at: 300 },
  ];

  it("become the lines and the grid snapping uses", () => {
    expect(snapAidsOf({ lines, grid: 24 })).toEqual({ lines: { x: [100, 300], y: [50] }, grid: 24 });
    expect(snapAidsOf(undefined)).toEqual({ lines: { x: [], y: [] }, grid: 0 });
  });

  it("move one guide, or take it away when it is dropped back on the ruler", () => {
    expect(movedGuide(lines, 1, 77.46)[1]).toEqual({ axis: "horizontal", at: 77.5 });
    expect(movedGuide(lines, 0, null)).toEqual([lines[1], lines[2]]);
  });

  it("add a guide without doubling one that is there", () => {
    expect(addedGuide(lines, "vertical", 400)).toHaveLength(4);
    expect(addedGuide(lines, "vertical", 100)).toEqual(lines);
  });
});
