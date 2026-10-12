// Page text size in the stored preferences: four sizes, and the old
// "Small text" switch carried over as the small one.

import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "kasten.prefs";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

/** The preferences as a window opening now would read them. */
async function open(stored?: unknown) {
  if (stored !== undefined) localStorage.setItem(KEY, JSON.stringify(stored));
  return (await import("./prefs")).usePrefs;
}

const kept = () => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;

describe("page text size", () => {
  it("is normal when nothing was stored", async () => {
    expect((await open()).getState().textSize).toBe("normal");
  });

  it("carries the old Small text switch over as the small size, and stops keeping the switch", async () => {
    const prefs = await open({ smallText: true, font: "serif" });
    expect(prefs.getState().textSize).toBe("small");
    expect(prefs.getState().font).toBe("serif");
    expect("smallText" in prefs.getState()).toBe(false);
    prefs.getState().set({ spellcheck: false });
    expect(kept()).toMatchObject({ textSize: "small", font: "serif" });
    expect(kept()).not.toHaveProperty("smallText");
  });

  it("reads the old switch turned off as normal", async () => {
    expect((await open({ smallText: false })).getState().textSize).toBe("normal");
  });

  it("keeps each of the four sizes", async () => {
    for (const size of ["small", "normal", "large", "xl"] as const) {
      vi.resetModules();
      localStorage.clear();
      const prefs = await open();
      prefs.getState().set({ textSize: size });
      expect(kept().textSize).toBe(size);
      vi.resetModules();
      expect((await import("./prefs")).usePrefs.getState().textSize).toBe(size);
    }
  });

  it("prefers a stored size to the old switch, and ignores a size it does not know", async () => {
    expect((await open({ textSize: "large", smallText: true })).getState().textSize).toBe("large");
    vi.resetModules();
    localStorage.clear();
    expect((await open({ textSize: "huge", smallText: true })).getState().textSize).toBe("small");
    vi.resetModules();
    localStorage.clear();
    expect((await open({ textSize: 18 })).getState().textSize).toBe("normal");
  });
});
