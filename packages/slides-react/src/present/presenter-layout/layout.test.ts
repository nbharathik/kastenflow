import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LAYOUT_KEY,
  SIDE_MAX,
  SIDE_MIN,
  SPLIT_MAX,
  SPLIT_MIN,
  applyPreset,
  clamp,
  defaultLayout,
  handleOfSplit,
  handleRange,
  isLastPanel,
  keepLayout,
  nudged,
  parseLayout,
  resetSide,
  resetSplit,
  savedLayout,
  serializeLayout,
  splitOfHandle,
  toggled,
  tracks,
  withSide,
  withSplit,
} from "./layout.ts";

beforeEach(() => localStorage.clear());

describe("clamping", () => {
  it("keeps a value between its limits", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("keeps the splits inside their minimums and maximums, and marks the layout as custom", () => {
    expect(withSplit(defaultLayout(), 0.01).split).toBe(SPLIT_MIN);
    expect(withSplit(defaultLayout(), 0.99).split).toBe(SPLIT_MAX);
    expect(withSide(defaultLayout(), 0).side).toBe(SIDE_MIN);
    expect(withSide(defaultLayout(), 2).side).toBe(SIDE_MAX);
    expect(withSplit(defaultLayout(), 0.5).preset).toBe("custom");
  });

  it("moves with the arrow keys by 2%, with Shift by 10%, and to the limits with Home and End", () => {
    expect(nudged(0.5, "ArrowRight", false, 0.2, 0.8, "ArrowRight", "ArrowLeft")).toBeCloseTo(0.52);
    expect(nudged(0.5, "ArrowLeft", true, 0.2, 0.8, "ArrowRight", "ArrowLeft")).toBeCloseTo(0.4);
    expect(nudged(0.79, "ArrowRight", true, 0.2, 0.8, "ArrowRight", "ArrowLeft")).toBe(0.8);
    expect(nudged(0.5, "Home", false, 0.2, 0.8, "ArrowRight", "ArrowLeft")).toBe(0.2);
    expect(nudged(0.5, "End", false, 0.2, 0.8, "ArrowRight", "ArrowLeft")).toBe(0.8);
    expect(nudged(0.5, "ArrowUp", false, 0.2, 0.8, "ArrowRight", "ArrowLeft")).toBeNull();
  });
});

describe("the presets", () => {
  it("start from the balanced layout, with every panel on", () => {
    const layout = defaultLayout();
    expect(layout.preset).toBe("balanced");
    expect(layout.show).toEqual({ now: true, next: true, notes: true, clock: true });
    expect(layout.then).toBe(false);
    expect(layout.swap).toBe(false);
  });

  it("give notes or the slides more room", () => {
    const base = defaultLayout();
    expect(applyPreset(base, "bigNotes").split).toBeLessThan(base.split);
    expect(applyPreset(base, "bigSlides").split).toBeGreaterThan(base.split);
    expect(applyPreset(base, "bigSlides").preset).toBe("bigSlides");
  });

  it("show only the notes for Notes only, and bring the slides back with another preset", () => {
    const only = applyPreset(defaultLayout(), "notesOnly");
    expect(only.show).toMatchObject({ now: false, next: false, notes: true });
    expect(applyPreset(only, "balanced").show).toMatchObject({ now: true, next: true, notes: true });
  });

  it("leave the side the slide is on, the strip and the clock row alone", () => {
    const set = { ...defaultLayout(), swap: true, then: true, show: { now: true, next: true, notes: true, clock: false } };
    const applied = applyPreset(set, "bigNotes");
    expect(applied).toMatchObject({ swap: true, then: true });
    expect(applied.show.clock).toBe(false);
  });
});

describe("showing and hiding panels", () => {
  it("hides and shows a panel, and calls the layout custom", () => {
    const hidden = toggled(defaultLayout(), "next");
    expect(hidden.show.next).toBe(false);
    expect(hidden.preset).toBe("custom");
    expect(toggled(hidden, "next").show.next).toBe(true);
  });

  it("never lets the last of the three panels go", () => {
    const one = toggled(toggled(defaultLayout(), "now"), "next");
    expect(one.show).toMatchObject({ now: false, next: false, notes: true });
    expect(isLastPanel(one, "notes")).toBe(true);
    expect(toggled(one, "notes")).toBe(one);
  });

  it("lets the clock row go whatever the panels are", () => {
    expect(toggled(defaultLayout(), "clock").show.clock).toBe(false);
    expect(toggled(defaultLayout(), "clock").preset).toBe("balanced");
  });
});

describe("resetting a splitter", () => {
  it("goes back to the preset's size, or the balanced one for a custom layout", () => {
    const wide = applyPreset(defaultLayout(), "bigSlides");
    expect(resetSplit({ ...wide, split: 0.3 }).split).toBe(wide.split);
    expect(resetSide({ ...wide, side: 0.2 }).side).toBe(wide.side);
    expect(resetSplit(withSplit(defaultLayout(), 0.3)).split).toBe(defaultLayout().split);
  });
});

describe("swapping the sides", () => {
  it("measures the handle from the left whichever side the slide is on", () => {
    const layout = { ...defaultLayout(), split: 0.7, swap: true };
    expect(handleOfSplit(layout)).toBeCloseTo(0.3);
    expect(splitOfHandle(layout, 0.3)).toBeCloseTo(0.7);
    const [lo, hi] = handleRange(layout);
    expect(lo).toBeCloseTo(1 - SPLIT_MAX);
    expect(hi).toBeCloseTo(1 - SPLIT_MIN);
    expect(handleRange(defaultLayout())).toEqual([SPLIT_MIN, SPLIT_MAX]);
  });
});

describe("the grid tracks", () => {
  it("is one track for one panel, else two with the bar between", () => {
    expect(tracks(null)).toBe("minmax(0, 1fr)");
    expect(tracks(0.6)).toBe("minmax(0, 60.00fr) 12px minmax(0, 40.00fr)");
  });
});

describe("keeping the layout", () => {
  it("comes back as it was kept", () => {
    const layout = { ...applyPreset(defaultLayout(), "bigNotes"), swap: true, then: true, show: { now: true, next: false, notes: true, clock: false } };
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
    keepLayout(layout);
    expect(localStorage.getItem(LAYOUT_KEY)).toContain('"v":1');
    expect(savedLayout()).toEqual(layout);
  });

  it("is the default when nothing is kept, or what is kept is not JSON or not an object", () => {
    expect(parseLayout(null)).toEqual(defaultLayout());
    expect(parseLayout("{nope")).toEqual(defaultLayout());
    expect(parseLayout("[1,2]")).toEqual(defaultLayout());
    expect(parseLayout("7")).toEqual(defaultLayout());
    expect(parseLayout(JSON.stringify({ v: 2, split: 0.5 }))).toEqual(defaultLayout());
  });

  it("takes a bad field as its default and keeps the good ones", () => {
    const parsed = parseLayout(JSON.stringify({ v: 1, split: 5, side: "wide", swap: "yes", then: true, preset: "weird", show: { now: false, next: 3, notes: true, clock: false } }));
    expect(parsed.split).toBe(defaultLayout().split);
    expect(parsed.side).toBe(defaultLayout().side);
    expect(parsed.swap).toBe(false);
    expect(parsed.then).toBe(true);
    expect(parsed.preset).toBe("balanced");
    expect(parsed.show).toEqual({ now: false, next: true, notes: true, clock: false });
  });

  it("refuses a stored layout with every panel off, and one with numbers out of range or not finite", () => {
    expect(parseLayout(JSON.stringify({ v: 1, show: { now: false, next: false, notes: false, clock: true } })).show).toMatchObject({ now: true, next: true, notes: true });
    expect(parseLayout(JSON.stringify({ v: 1, split: 0.01, side: 0.99 }))).toMatchObject({ split: defaultLayout().split, side: defaultLayout().side });
    expect(parseLayout('{"v":1,"split":null}').split).toBe(defaultLayout().split);
  });

  it("is the default when storage cannot be read, and does not throw when it cannot be written", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(savedLayout()).toEqual(defaultLayout());
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => keepLayout(defaultLayout())).not.toThrow();
    set.mockRestore();
  });
});
