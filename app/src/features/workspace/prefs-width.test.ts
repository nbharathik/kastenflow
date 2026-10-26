// The old "Full width" switch becomes the three-way page width.

import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadWith(saved: object | null) {
  localStorage.clear();
  if (saved) localStorage.setItem("kasten.prefs", JSON.stringify(saved));
  vi.resetModules();
  return (await import("./prefs")).usePrefs;
}

describe("the page width preference", () => {
  beforeEach(() => localStorage.clear());

  it("turns fullWidth: true into full and false into normal", async () => {
    expect((await loadWith({ fullWidth: true })).getState().pageWidth).toBe("full");
    expect((await loadWith({ fullWidth: false })).getState().pageWidth).toBe("normal");
  });

  it("defaults to normal, keeps a saved width, and ignores a junk one", async () => {
    expect((await loadWith(null)).getState().pageWidth).toBe("normal");
    expect((await loadWith({ pageWidth: "wide" })).getState().pageWidth).toBe("wide");
    expect((await loadWith({ pageWidth: "huge" })).getState().pageWidth).toBe("normal");
  });

  it("saves pageWidth and drops the old key", async () => {
    const prefs = await loadWith({ fullWidth: true });
    prefs.getState().set({ pageWidth: "wide" });
    const saved = JSON.parse(localStorage.getItem("kasten.prefs")!);
    expect(saved.pageWidth).toBe("wide");
    expect(saved).not.toHaveProperty("fullWidth");
  });
});
