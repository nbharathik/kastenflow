import { describe, expect, it } from "vitest";

import { INBOX, JOURNAL, NO_FILTERS, PAGES } from "../library/filters";
import { savedQuery, savedSearch } from "./from-search";

const NOW = new Date(2026, 9, 10, 12); // Saturday 2026-10-10

describe("savedSearch", () => {
  it("keeps the words typed and nothing else when no filter is set", () => {
    expect(savedSearch("  slip box ", NO_FILTERS, 1, NOW)).toEqual({ edits: { query: "slip box" }, name: "slip box", dropped: [] });
    expect(savedSearch("", NO_FILTERS, 1, NOW)).toEqual({ edits: { query: "" }, name: "Saved search", dropped: [] });
  });

  it("turns the filters into the search box's own words", () => {
    const saved = savedSearch("photos", { ...NO_FILTERS, kind: "card", place: "photo-organiser", tag: "capture" }, 1, NOW);
    expect(saved.edits).toEqual({ query: "photos type:card project:photo-organiser #capture" });
    expect(saved.dropped).toEqual([]);
    expect(savedSearch("", { ...NO_FILTERS, place: JOURNAL }, 1, NOW).edits.query).toBe("type:journal");
  });

  it("keeps a preset as a relative span, so the collection moves with the days", () => {
    expect(savedSearch("", { ...NO_FILTERS, updated: "week" }, 1, NOW).edits).toEqual({ query: "", when: { updated: "this-week" } });
    expect(savedSearch("", { ...NO_FILTERS, updated: "today", created: "last-month" }, 1, NOW).edits.when).toEqual({ updated: "today", created: "last-month" });
    expect(savedSearch("", { ...NO_FILTERS, updated: "month" }, 1, NOW).edits.when).toEqual({ updated: "this-month" });
  });

  it("writes a chosen month, a range and last week as the days they are", () => {
    expect(savedSearch("", { ...NO_FILTERS, updated: "month:2026-09" }, 1, NOW).edits).toEqual({ query: "updated:2026-09" });
    expect(savedSearch("x", { ...NO_FILTERS, created: "range:2026-09-01..2026-09-15" }, 1, NOW).edits).toEqual({ query: "x created:2026-09-01..2026-09-15" });
    expect(savedSearch("", { ...NO_FILTERS, created: "range:2026-09-01.." }, 1, NOW).edits.query).toBe("created:2026-09-01..");
    expect(savedSearch("", { ...NO_FILTERS, updated: "last-week" }, 1, NOW).edits.query).toBe("updated:2026-09-28..2026-10-04");
    expect(savedSearch("", { ...NO_FILTERS, updated: "last-week" }, 0, NOW).edits.query).toBe("updated:2026-09-27..2026-10-03");
  });

  it("says what a collection cannot hold", () => {
    const saved = savedSearch("", { ...NO_FILTERS, noBoard: true, orphans: true, place: INBOX }, 1, NOW);
    expect(saved.dropped).toEqual(["the Inbox", "“on no board”", "“no links in or out”"]);
    expect(saved.edits.query).toBe("");
    expect(savedSearch("", { ...NO_FILTERS, place: PAGES }, 1, NOW).dropped).toEqual(["Pages that are in no project"]);
  });

  it("names the collection by what was searched, else the tag or the project", () => {
    expect(savedSearch("", { ...NO_FILTERS, tag: "paper" }, 1, NOW).name).toBe("#paper");
    expect(savedSearch("", { ...NO_FILTERS, place: "trip" }, 1, NOW).name).toBe("trip");
    expect(savedSearch("x".repeat(60), NO_FILTERS, 1, NOW).name).toHaveLength(40);
  });
});

describe("savedQuery", () => {
  it("is the text as typed", () => {
    expect(savedQuery(" #capture  updated:2026-10 ")).toEqual({ edits: { query: "#capture  updated:2026-10" }, name: "#capture  updated:2026-10", dropped: [] });
  });
});
