import { describe, expect, it } from "vitest";

import type { BoardInfo, DeckInfo, NoteMeta } from "../../../lib/vault/types";
import { parseQuery } from "../../library/filters";
import { NO_FILTERS, capturesOf, filterItems, hasFilters, itemsOf, sortItems, tagCounts, typeLabel, type ItemFilters } from "./items";

/** Noon of a day, in local time, in milliseconds. */
const day = (text: string) => new Date(`${text}T12:00:00`).getTime();
const note = (path: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: "trip",
  tags: [],
  modified: day("2026-09-01"),
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});

const NOTES: NoteMeta[] = [
  note("projects/trip/pages/plan.md", { tags: ["Paper"], updated: "2026-10-04T12:00:00", created: "2026-09-20", excerpt: "Route and dates" }),
  note("projects/trip/cards/idea.md", { kind: "card", tags: ["capture", "idea"], updated: "2026-10-02T12:00:00" }),
  note("projects/trip/cards/lunch.md", { kind: "card", excerpt: "Eat well" }),
  note("projects/trip/_project.md", { kind: "project", title: "Trip" }),
  note("projects/work/pages/report.md", { project: "work" }),
  note("inbox/loose.md", { kind: "card", project: null, tags: ["capture"] }),
  note("templates/page.md", { kind: "template", project: null }),
];
const BOARDS: BoardInfo[] = [
  { path: "projects/trip/boards/map.canvas", title: "Map", project: "trip", nodes: 3, modified: day("2026-10-01") },
  { path: "projects/work/boards/x.canvas", title: "Other", project: "work", nodes: 0, modified: 1 },
];
const DECKS: DeckInfo[] = [{ path: "projects/trip/talk.deck", title: "Pitch", project: "trip", slides: 4, modified: day("2026-10-03"), size: 10, problem: null }];

const items = () => itemsOf(NOTES, BOARDS, DECKS, "trip");
const find = (text: string, filters: ItemFilters = NO_FILTERS, hits: ReadonlySet<string> | null = null) => filterItems(items(), filters, { query: parseQuery(text), hits, now: day("2026-10-06") }).map((i) => i.title);

describe("the project's items", () => {
  it("lists its pages, cards, boards and decks, leaving out the project page, templates and other projects", () => {
    expect(items().map((i) => [i.kind, i.title])).toEqual([
      ["page", "plan"],
      ["card", "idea"],
      ["card", "lunch"],
      ["board", "Map"],
      ["deck", "Pitch"],
    ]);
  });

  it("marks a card tagged capture", () => {
    const [plan, idea, lunch] = items();
    expect([plan!.capture, idea!.capture, lunch!.capture]).toEqual([false, true, false]);
    expect(typeLabel(idea!)).toBe("Capture");
    expect(typeLabel(plan!)).toBe("Page");
    expect(typeLabel({ kind: "board", capture: false })).toBe("Whiteboard");
  });

  it("takes dates from the note, and the file time for one with none", () => {
    const [plan, , lunch] = items();
    expect(plan!.updated).toBe(day("2026-10-04"));
    expect(plan!.created).toBe(new Date(2026, 8, 20).getTime());
    expect(lunch!.updated).toBe(day("2026-09-01"));
    expect(lunch!.created).toBeNull();
  });
});

describe("finding and filtering items", () => {
  it("finds by the words in title, tags and excerpt, and by what the full-text search found", () => {
    expect(find("")).toHaveLength(5);
    expect(find("plan")).toEqual(["plan"]);
    expect(find("eat WELL")).toEqual(["lunch"]);
    expect(find("route")).toEqual(["plan"]);
    expect(find("zzz")).toEqual([]);
    expect(find("zzz", NO_FILTERS, new Set(["projects/trip/cards/idea.md"]))).toEqual(["idea"]);
  });

  it("reads tag:, #tag and type: as the Library does", () => {
    expect(find("tag:paper")).toEqual(["plan"]);
    expect(find("#idea")).toEqual(["idea"]);
    expect(find("type:card")).toEqual(["idea", "lunch"]);
    expect(find("type:board")).toEqual(["Map"]);
  });

  it("reads on:, created: and updated: dates, and after: and before:", () => {
    expect(find("updated:2026-10")).toEqual(["plan", "idea", "Map", "Pitch"]);
    expect(find("updated:2026-10-04")).toEqual(["plan"]);
    expect(find("created:2026-09")).toEqual(["plan"]);
    expect(find("on:2026-10-02")).toEqual(["idea"]);
    // `after` leaves the day itself out, `before` too.
    expect(find("after:2026-10-03")).toEqual(["plan"]);
    expect(find("before:2026-10-02")).toEqual(["lunch", "Map"]);
  });

  it("leaves a project: in the search alone", () => {
    expect(find("project:somewhere-else")).toHaveLength(5);
  });

  it("filters by type, tag and date presets", () => {
    expect(find("", { ...NO_FILTERS, kind: "card" })).toEqual(["idea", "lunch"]);
    expect(find("", { ...NO_FILTERS, kind: "deck" })).toEqual(["Pitch"]);
    expect(find("", { ...NO_FILTERS, tag: "capture" })).toEqual(["idea"]);
    expect(find("", { ...NO_FILTERS, updated: "month" })).toEqual(["plan", "idea", "Map", "Pitch"]);
    expect(find("", { ...NO_FILTERS, created: "last-month" })).toEqual(["plan"]);
    expect(find("", { kind: "page", tag: "paper", updated: "any", created: "any" })).toEqual(["plan"]);
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, tag: "x" })).toBe(true);
  });
});

describe("ordering and counting", () => {
  const by = (key: "updated" | "created" | "title" | "type", dir: "asc" | "desc") => sortItems(items(), { key, dir }).map((i) => i.title);

  it("sorts by update, title, type and creation", () => {
    expect(by("updated", "desc")).toEqual(["plan", "Pitch", "idea", "Map", "lunch"]);
    expect(by("updated", "asc")).toEqual(["lunch", "Map", "idea", "Pitch", "plan"]);
    expect(by("title", "asc")).toEqual(["idea", "lunch", "Map", "Pitch", "plan"]);
    // Capture, Card, Deck, Page, Whiteboard.
    expect(by("type", "asc")).toEqual(["idea", "lunch", "Pitch", "plan", "Map"]);
    // Items with no creation date go last whichever way.
    expect(by("created", "desc")[0]).toBe("plan");
    expect(by("created", "asc")[0]).toBe("plan");
  });

  it("counts tags, the most used first", () => {
    expect(tagCounts(items())).toEqual([
      { tag: "capture", count: 1 },
      { tag: "idea", count: 1 },
      { tag: "paper", count: 1 },
    ]);
  });

  it("finds the project's captures and those not filed in any project", () => {
    const { filed, unfiled } = capturesOf(NOTES, "trip");
    expect(filed.map((n) => n.title)).toEqual(["idea"]);
    expect(unfiled.map((n) => n.title)).toEqual(["loose"]);
    expect(capturesOf(NOTES, "work").filed).toEqual([]);
    expect(capturesOf(NOTES, "work").unfiled).toEqual(unfiled);
  });
});
