import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autoLevel, choiceFor, createZoom, displayOf, keepChoice, levelOf, stepZoom, useZoom, zoomBy, type Display, type ZoomHost } from "./zoom";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

const BY_DISPLAY = "kasten.zoom.byDisplay";
const kept = () => JSON.parse(localStorage.getItem(BY_DISPLAY) ?? "{}") as Record<string, unknown>;

const laptop: Display = { key: "laptop", width: 1280 };
const monitor: Display = { key: "monitor", width: 2560 };

/** A window that can be dragged between displays, and what was asked of it. */
function fakeWindow(start: Display) {
  const win = {
    display: start,
    applied: [] as number[],
    asked: 0,
    changed: null as (() => void) | null,
  };
  const host: ZoomHost = {
    display: async () => {
      win.asked++;
      return win.display;
    },
    apply: async (level) => void win.applied.push(level),
    watch: async (changed) => {
      win.changed = changed;
      return () => void (win.changed = null);
    },
  };
  return { win, zoom: createZoom(() => host) };
}

describe("window zoom steps", () => {
  it("steps through the levels and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.67, -1)).toBe(0.67);
    expect(stepZoom(1.5, 0)).toBe(1);
  });

  it("steps from a level between two, to the next one in that direction", () => {
    expect(stepZoom(1.05, 1)).toBe(1.25);
    expect(stepZoom(1.05, -1)).toBe(1);
  });
});

describe("Auto", () => {
  it("picks a level from the display's logical width", () => {
    expect([1000, 1399].map(autoLevel)).toEqual([0.9, 0.9]);
    expect([1400, 1920, 2200].map(autoLevel)).toEqual([1, 1, 1]);
    expect([2201, 2560, 3000].map(autoLevel)).toEqual([1.1, 1.1, 1.1]);
    expect([3001, 3840, 5120].map(autoLevel)).toEqual([1.25, 1.25, 1.25]);
  });

  it("leaves a display of unknown width at 100%", () => {
    expect(autoLevel(0)).toBe(1);
    expect(autoLevel(Number.NaN)).toBe(1);
  });

  it("is the level for a display until a level is chosen, which then wins", () => {
    expect(levelOf("auto", laptop)).toBe(0.9);
    expect(levelOf("auto", monitor)).toBe(1.1);
    expect(levelOf(1.5, laptop)).toBe(1.5);
  });
});

describe("a display", () => {
  it("is told apart by name, size and scale, and measured in logical pixels", () => {
    const a = displayOf({ name: "\\\\.\\DISPLAY1", size: { width: 3840, height: 2160 }, scaleFactor: 1.5 });
    expect(a.width).toBe(2560);
    const same = displayOf({ name: "\\\\.\\DISPLAY1", size: { width: 3840, height: 2160 }, scaleFactor: 1.5 });
    const rescaled = displayOf({ name: "\\\\.\\DISPLAY1", size: { width: 3840, height: 2160 }, scaleFactor: 2 });
    const other = displayOf({ name: "\\\\.\\DISPLAY2", size: { width: 3840, height: 2160 }, scaleFactor: 1.5 });
    expect(same.key).toBe(a.key);
    expect(new Set([a.key, rescaled.key, other.key]).size).toBe(3);
    expect(rescaled.width).toBe(1920);
  });

  it("copes with a monitor that has no name or a scale of 0", () => {
    const odd = displayOf({ name: null, size: { width: 1920, height: 1080 }, scaleFactor: 0 });
    expect(odd.width).toBe(1920);
    expect(odd.key).toContain("1920x1080");
  });
});

describe("the level kept for each display", () => {
  it("follows Auto for a display that was never set, and keeps what is chosen for it alone", () => {
    expect(choiceFor("laptop")).toBe("auto");
    keepChoice("laptop", 1.25);
    keepChoice("monitor", "auto");
    expect(choiceFor("laptop")).toBe(1.25);
    expect(choiceFor("monitor")).toBe("auto");
    expect(kept()).toEqual({ laptop: 1.25, monitor: "auto" });
  });

  it("takes the old single level for a display with none of its own, once, and then keeps its own", () => {
    localStorage.setItem("kasten.zoom", "1.25");
    expect(choiceFor("laptop")).toBe(1.25);
    expect(kept()).toEqual({ laptop: 1.25 });
    // Another display that was never set takes it too, each once.
    expect(choiceFor("monitor")).toBe(1.25);
    keepChoice("laptop", 0.9);
    expect(choiceFor("laptop")).toBe(0.9);
    expect(choiceFor("monitor")).toBe(1.25);
  });

  it("ignores an old level that is not one of the levels", () => {
    localStorage.setItem("kasten.zoom", "7");
    expect(choiceFor("laptop")).toBe("auto");
    localStorage.setItem("kasten.zoom", "not a number");
    expect(choiceFor("laptop")).toBe("auto");
    expect(kept()).toEqual({});
  });

  it("ignores stored entries that are damaged, and keeps the good ones", () => {
    localStorage.setItem(BY_DISPLAY, JSON.stringify({ laptop: 1.25, monitor: 3, tv: "big", broken: null, ok: "auto" }));
    expect([choiceFor("laptop"), choiceFor("monitor"), choiceFor("tv"), choiceFor("ok")]).toEqual([1.25, "auto", "auto", "auto"]);
    for (const text of ["[1,2]", "7", "{not json", "null"]) {
      localStorage.setItem(BY_DISPLAY, text);
      expect(choiceFor("laptop")).toBe("auto");
    }
  });

  it("remembers a bounded number of displays, never dropping the one just set", () => {
    for (let i = 0; i < 40; i++) keepChoice(`display ${i}`, 1.1);
    const keys = Object.keys(kept());
    expect(keys.length).toBe(24);
    expect(keys).toContain("display 39");
    expect(keys).not.toContain("display 0");
  });
});

describe("dragging the window between displays", () => {
  it("picks each display's own level, and a change on one leaves the other alone", async () => {
    const { win, zoom } = fakeWindow(laptop);
    await zoom.refresh();
    expect(win.applied).toEqual([0.9]);
    expect(useZoom.getState()).toMatchObject({ choice: "auto", level: 0.9, auto: 0.9 });

    // Ctrl+= on the laptop panel.
    expect(await zoom.zoomBy(1)).toBe(1);
    expect(kept()).toEqual({ laptop: 1 });

    // Drag to the big monitor: Auto there; Ctrl+= steps from what it shows.
    win.display = monitor;
    await zoom.refresh();
    expect(useZoom.getState()).toMatchObject({ choice: "auto", level: 1.1, auto: 1.1 });
    expect(await zoom.zoomBy(1)).toBe(1.25);

    // Back again: the laptop's own level, untouched by the monitor.
    win.display = laptop;
    await zoom.refresh();
    expect(useZoom.getState()).toMatchObject({ choice: 1, level: 1 });
    expect(win.applied).toEqual([0.9, 1, 1.1, 1.25, 1]);
    expect(kept()).toEqual({ laptop: 1, monitor: 1.25 });
  });

  it("does nothing while the window stays on the display it showed", async () => {
    const { win, zoom } = fakeWindow(monitor);
    await zoom.refresh();
    await zoom.refresh();
    await zoom.refresh();
    expect(win.applied).toEqual([1.1]);
  });

  it("returns to Auto when asked, and to 100% for 0", async () => {
    const { win, zoom } = fakeWindow(laptop);
    await zoom.choose(1.5);
    expect(kept()).toEqual({ laptop: 1.5 });
    expect(await zoom.choose("auto")).toBe(0.9);
    expect(kept()).toEqual({ laptop: "auto" });
    expect(await zoom.zoomBy(0)).toBe(1);
    expect(kept()).toEqual({ laptop: 1 });
    expect(win.applied).toEqual([1.5, 0.9, 1]);
  });

  it("gives a display that has not been set the old single level, once", async () => {
    localStorage.setItem("kasten.zoom", "1.5");
    const { win, zoom } = fakeWindow(laptop);
    await zoom.refresh();
    expect(win.applied).toEqual([1.5]);
    win.display = monitor;
    await zoom.refresh();
    expect(win.applied).toEqual([1.5]);
    await zoom.zoomBy(-1);
    expect(kept()).toEqual({ laptop: 1.5, monitor: 1.25 });
  });

  it("keeps presses and moves in order when they come together", async () => {
    const { win, zoom } = fakeWindow(laptop);
    await zoom.refresh();
    win.display = monitor;
    const moved = zoom.refresh();
    const pressed = zoom.zoomBy(1);
    await Promise.all([moved, pressed]);
    expect(kept()).toEqual({ monitor: 1.25 });
    expect(win.applied.at(-1)).toBe(1.25);
  });
});

describe("start-up", () => {
  it("opens at the level shown last time, before the display is known, then at the display's own", async () => {
    vi.useFakeTimers();
    localStorage.setItem("kasten.zoom.last", "1.25");
    keepChoice("monitor", 1.1);
    const { win, zoom } = fakeWindow(monitor);
    zoom.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(win.applied).toEqual([1.25, 1.1]);
  });

  it("opens at the old single level when nothing was shown yet", async () => {
    vi.useFakeTimers();
    localStorage.setItem("kasten.zoom", "1.5");
    const { win, zoom } = fakeWindow(laptop);
    zoom.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(win.applied).toEqual([1.5]);
  });

  it("asks nothing of the window at 100%", async () => {
    vi.useFakeTimers();
    const { win, zoom } = fakeWindow({ key: "unknown", width: 0 });
    zoom.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(win.applied).toEqual([]);
  });

  it("looks again once a window that was moved has settled, not at every step of the drag", async () => {
    vi.useFakeTimers();
    const { win, zoom } = fakeWindow(laptop);
    zoom.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(win.applied).toEqual([0.9]);
    const asked = win.asked;

    win.display = monitor;
    for (let step = 0; step < 20; step++) {
      win.changed!();
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(win.asked).toBe(asked);
    await vi.advanceTimersByTimeAsync(300);
    expect(win.asked).toBe(asked + 1);
    expect(win.applied).toEqual([0.9, 1.1]);
  });
});

describe("the browser preview", () => {
  it("has one display, keeps its level for next time and scales the preview's page", async () => {
    const zoomStyle = () => document.documentElement.style.getPropertyValue("zoom");
    expect(await zoomBy(1)).toBe(1.1);
    expect(await zoomBy(1)).toBe(1.25);
    expect(zoomStyle()).toBe("1.25");
    expect(kept()).toEqual({ browser: 1.25 });
    expect(localStorage.getItem("kasten.zoom.last")).toBe("1.25");
    expect(useZoom.getState()).toMatchObject({ choice: 1.25, level: 1.25 });
    expect(await zoomBy(0)).toBe(1);
    expect(zoomStyle()).toBe("");
  });
});
