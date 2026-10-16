import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_HUB, readSaved, useHubPrefs } from "./hub-prefs";

const stored = () => JSON.parse(localStorage.getItem("kasten.projects-hub") ?? "null") as Record<string, unknown> | null;

beforeEach(() => {
  localStorage.clear();
  useHubPrefs.setState({ vault: "", prefs: DEFAULT_HUB });
});

describe("what the hub remembers", () => {
  it("starts as a gallery in the person's own order, showing every status", () => {
    expect(DEFAULT_HUB).toEqual({ layout: "gallery", sort: "manual", status: "all" });
  });

  it("reads only what is valid from what was stored", () => {
    expect(readSaved({ layout: "list", sort: "name", status: "paused" })).toEqual({ layout: "list", sort: "name", status: "paused" });
    expect(readSaved({ layout: "table", sort: "random", status: 3 })).toEqual(DEFAULT_HUB);
    expect(readSaved(null)).toEqual(DEFAULT_HUB);
    expect(readSaved("list")).toEqual(DEFAULT_HUB);
  });

  it("keeps a choice for each vault apart", () => {
    useHubPrefs.getState().open("/notes/work");
    useHubPrefs.getState().set({ layout: "list", sort: "recent" });
    useHubPrefs.getState().open("/notes/home");
    expect(useHubPrefs.getState().prefs).toEqual(DEFAULT_HUB);
    useHubPrefs.getState().set({ status: "active" });
    useHubPrefs.getState().open("/notes/work");
    expect(useHubPrefs.getState().prefs).toEqual({ layout: "list", sort: "recent", status: "all" });
    expect(Object.keys(stored()!).sort()).toEqual(["/notes/home", "/notes/work"]);
  });

  it("is read again after a reload", () => {
    useHubPrefs.getState().open("/notes/work");
    useHubPrefs.getState().set({ layout: "list" });
    useHubPrefs.setState({ vault: "", prefs: DEFAULT_HUB });
    useHubPrefs.getState().open("/notes/work");
    expect(useHubPrefs.getState().prefs.layout).toBe("list");
  });

  it("carries on when storage is full or blocked", () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    try {
      useHubPrefs.getState().open("/notes/work");
      useHubPrefs.getState().set({ layout: "list" });
      expect(useHubPrefs.getState().prefs.layout).toBe("list");
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});
