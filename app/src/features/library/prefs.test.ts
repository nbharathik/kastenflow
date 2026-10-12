import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFS, loadPrefs, readPrefs, savePrefs } from "./prefs";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("library prefs", () => {
  it("starts on the grid, newest first, with no filters", () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(readPrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(readPrefs("42")).toEqual(DEFAULT_PREFS);
  });

  it("keeps sensible values and drops the rest", () => {
    const prefs = readPrefs(
      JSON.stringify({
        mode: "table",
        sort: { key: "title", dir: "sideways" },
        filters: { kind: "card", place: "photo-organiser", tag: "Paper", updated: "century", noBoard: true, orphans: "yes" },
      }),
    );
    expect(prefs).toEqual({
      mode: "table",
      sort: { key: "title", dir: "desc" },
      filters: { kind: "card", place: "photo-organiser", tag: "paper", updated: "any", created: "any", noBoard: true, orphans: false },
      group: "none",
    });
    expect(readPrefs(JSON.stringify({ mode: "list", sort: { key: "size" }, filters: { kind: "board", place: 7, tag: "" } }))).toEqual(DEFAULT_PREFS);
  });

  it("keeps the date filters and the grouping, and what older versions stored", () => {
    const prefs = readPrefs(JSON.stringify({ filters: { updated: "week", created: "range:2026-09-01..2026-09-15" }, group: "month" }));
    expect(prefs.filters).toMatchObject({ updated: "week", created: "range:2026-09-01..2026-09-15" });
    expect(prefs.group).toBe("month");
    // A month is a value older versions had too.
    expect(readPrefs(JSON.stringify({ filters: { updated: "month" } })).filters.updated).toBe("month");
    expect(readPrefs(JSON.stringify({ filters: { created: "month:2026-13" }, group: "colour" }))).toEqual(DEFAULT_PREFS);
  });

  it("round-trips through the browser's storage under kasten.library", () => {
    const prefs = { ...DEFAULT_PREFS, mode: "table" as const, filters: { ...DEFAULT_PREFS.filters, orphans: true } };
    savePrefs(prefs);
    expect(JSON.parse(localStorage.getItem("kasten.library")!)).toEqual(prefs);
    expect(loadPrefs()).toEqual(prefs);
  });

  it("works when storage is off", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
  });
});
