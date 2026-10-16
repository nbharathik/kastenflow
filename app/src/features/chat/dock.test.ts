import { beforeEach, describe, expect, it } from "vitest";

import { clampWidth, DOCK_WIDTH, dockLayout, loadWidth, PANE_MIN, WIDTH_KEY, keepWidth } from "./dock";

beforeEach(() => localStorage.clear());

describe("the dock's width", () => {
  it("starts at 420 and stays between 320 and 720", () => {
    expect(DOCK_WIDTH).toEqual({ initial: 420, min: 320, max: 720 });
    expect(loadWidth()).toBe(420);
    expect(clampWidth(100)).toBe(320);
    expect(clampWidth(5000)).toBe(720);
    expect(clampWidth(500.6)).toBe(501);
  });

  it("leaves the panes their room when the window allows it", () => {
    // 1400 wide: up to 720, as asked.
    expect(clampWidth(720, 1400)).toBe(720);
    // 1000 wide: the panes keep PANE_MIN, so the dock gets what is left.
    expect(clampWidth(720, 1000)).toBe(1000 - PANE_MIN);
    expect(clampWidth(400, 1000)).toBe(400);
    // Too narrow to keep both: the narrowest dock, which the layout then expands.
    expect(clampWidth(500, 600)).toBe(320);
  });

  it("is remembered, and a stored value is checked", () => {
    keepWidth(560);
    expect(localStorage.getItem(WIDTH_KEY)).toBe("560");
    expect(loadWidth()).toBe(560);
    for (const junk of ["", "wide", "NaN", "Infinity", "-5", "100", "9999", "[420]", "4e2x", "0x1f4", "420.5"]) {
      localStorage.setItem(WIDTH_KEY, junk);
      expect(loadWidth(), junk).toBe(420);
    }
    // A number in range as text is fine, whole or not rounded off.
    localStorage.setItem(WIDTH_KEY, "333");
    expect(loadWidth()).toBe(333);
  });

  it("carries on when storage is not there", () => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    try {
      expect(loadWidth()).toBe(420);
      expect(() => keepWidth(500)).not.toThrow();
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });
});

describe("the dock's layout", () => {
  it("docks beside the panes while they keep their room, and takes the area when they would not", () => {
    expect(PANE_MIN).toBe(480);
    expect(dockLayout(1000, 420)).toBe("docked");
    expect(dockLayout(900, 420)).toBe("docked");
    expect(dockLayout(899, 420)).toBe("expanded");
    expect(dockLayout(700, 320)).toBe("expanded");
    expect(dockLayout(1200, 720)).toBe("docked");
    expect(dockLayout(1100, 720)).toBe("expanded");
    // Another room for the panes.
    expect(dockLayout(700, 320, 360)).toBe("docked");
    expect(dockLayout(0, 420)).toBe("expanded");
  });
});
