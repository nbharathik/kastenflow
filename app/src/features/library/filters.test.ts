import { describe, expect, it } from "vitest";

import type { NoteMeta, NoteStats } from "../../lib/vault/types";
import {
  INBOX,
  JOURNAL,
  NO_FILTERS,
  PAGES,
  buildRows,
  filterRows,
  firstDir,
  hasFilters,
  kindLabel,
  parseDate,
  parseQuery,
  sortRows,
  tagCounts,
  updatedSince,
  type FilterContext,
  type Filters,
  type Row,
} from "./filters";

function meta(path: string, patch: Partial<NoteMeta> = {}): NoteMeta {
  const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const parts = path.split("/");
  return {
    path,
    id: null,
    title: stem,
    kind: "page",
    icon: null,
    cover: null,
    parent: null,
    project: parts[0] === "projects" ? parts[1]! : null,
    tags: [],
    modified: 0,
    created: null,
    updated: null,
    excerpt: "",
    words: 0,
    props: {},
    locked: false,
    ...patch,
  };
}

// Thursday 24 September 2026, 15:00 local time.
const NOW = new Date(2026, 8, 24, 15, 0).getTime();
const at = (day: number, hour = 12) => new Date(2026, 8, day, hour).toISOString();

const NOTES: NoteMeta[] = [
  meta("inbox/call-the-printer.md", { title: "Call the printer", kind: "card", tags: ["task"], updated: at(24, 9), excerpt: "Ask about the A3 poster" }),
  meta("library/zettelkasten.md", { title: "Zettelkasten method", tags: ["Reference"], created: at(2), updated: at(20), excerpt: "One idea per card, linked densely." }),
  meta("projects/photo-organiser/_project.md", { title: "Photo organiser", kind: "project", created: at(1), updated: at(1) }),
  meta("projects/photo-organiser/cards/diff-metric.md", { title: "Diff metric", kind: "card", tags: ["idea", "paper"], created: at(23), updated: at(23), excerpt: "A hash-matched photo diff." }),
  meta("projects/photo-organiser/pages/roadmap.md", { title: "Roadmap", tags: ["paper"], updated: "2026-08-30", excerpt: "Phase one, then two." }),
  meta("projects/orphaned/pages/lost.md", { title: "Lost page", modified: new Date(2026, 8, 22).getTime() }),
  meta("journal/2026/2026-09-23.md", { title: "2026-09-23", kind: "journal", created: at(23, 8), updated: at(23, 18), excerpt: "Morning notes" }),
  meta("templates/paper.md", { title: "{{title}}", kind: "template" }),
];

const ROWS = buildRows(NOTES);
const row = (path: string) => ROWS.find((r) => r.path === path)!;
const paths = (rows: Row[]) => rows.map((r) => r.path.slice(r.path.lastIndexOf("/") + 1));

const STATS = new Map<string, NoteStats>(
  [
    { path: "projects/photo-organiser/cards/diff-metric.md", backlinks: 3, links: 1, boards: 1 },
    { path: "projects/photo-organiser/pages/roadmap.md", backlinks: 3, links: 2, boards: 0 },
    { path: "library/zettelkasten.md", backlinks: 0, links: 1, boards: 0 },
    { path: "inbox/call-the-printer.md", backlinks: 0, links: 0, boards: 0 },
  ].map((s) => [s.path, s]),
);

function filtered(filters: Partial<Filters>, context: Partial<FilterContext> = {}): string[] {
  return paths(filterRows(ROWS, { ...NO_FILTERS, ...filters }, { stats: STATS, query: parseQuery(""), hits: null, now: NOW, ...context }));
}

describe("buildRows", () => {
  it("leaves templates out and keeps every other note", () => {
    expect(ROWS).toHaveLength(NOTES.length - 1);
    expect(ROWS.some((r) => r.note.kind === "template")).toBe(false);
  });

  it("names where each note lives", () => {
    expect([row("inbox/call-the-printer.md").place, row("inbox/call-the-printer.md").placeLabel]).toEqual([INBOX, "Inbox"]);
    expect([row("library/zettelkasten.md").place, row("library/zettelkasten.md").placeLabel]).toEqual([PAGES, "Pages"]);
    expect([row("journal/2026/2026-09-23.md").place, row("journal/2026/2026-09-23.md").placeLabel]).toEqual([JOURNAL, "Journal"]);
    // A project is named by its overview page, else by its folder.
    expect([row("projects/photo-organiser/pages/roadmap.md").place, row("projects/photo-organiser/pages/roadmap.md").placeLabel]).toEqual(["photo-organiser", "Photo organiser"]);
    expect(row("projects/orphaned/pages/lost.md").placeLabel).toBe("orphaned");
  });

  it("shows titles and icons as lists do", () => {
    expect(row("journal/2026/2026-09-23.md").title).toMatch(/2026/);
    expect(row("journal/2026/2026-09-23.md").title).not.toBe("2026-09-23");
    expect(row("projects/photo-organiser/cards/diff-metric.md").icon).toBe("icon:card");
  });

  it("dates a note by its own dates, else its file time", () => {
    expect(row("projects/photo-organiser/cards/diff-metric.md").updated).toBe(Date.parse(at(23)));
    expect(row("projects/photo-organiser/pages/roadmap.md").updated).toBe(new Date(2026, 7, 30).getTime());
    expect(row("projects/orphaned/pages/lost.md").updated).toBe(new Date(2026, 8, 22).getTime());
    expect(row("projects/orphaned/pages/lost.md").created).toBeNull();
    const createdOnly = buildRows([meta("library/a.md", { created: at(3), modified: NOW })])[0]!;
    expect(createdOnly.updated).toBe(Date.parse(at(3)));
  });

  it("makes rows again only for notes that changed", () => {
    const again = buildRows(NOTES);
    expect(again.every((r, i) => r === ROWS[i])).toBe(true);
    const renamed = NOTES.map((n) => (n.kind === "project" ? { ...n, title: "Thumbnails" } : n));
    const next = buildRows(renamed);
    expect(next.find((r) => r.path.endsWith("roadmap.md"))!.placeLabel).toBe("Thumbnails");
    expect(next.find((r) => r.path.startsWith("inbox/"))).toBe(ROWS[0]);
  });

  it("finds by lower-case title, tags and excerpt", () => {
    expect(row("library/zettelkasten.md").haystack).toContain("zettelkasten method");
    expect(row("library/zettelkasten.md").haystack).toContain("reference");
    expect(row("library/zettelkasten.md").haystack).toContain("linked densely");
    expect(row("library/zettelkasten.md").tags).toEqual(["reference"]);
  });
});

describe("parseDate", () => {
  it("reads days as local midnight and full times as written", () => {
    expect(parseDate("2026-09-24")).toBe(new Date(2026, 8, 24).getTime());
    expect(parseDate("2026-09-24", 1)).toBe(new Date(2026, 8, 25).getTime());
    expect(parseDate("2026-09-23T10:40:00+02:00")).toBe(Date.UTC(2026, 8, 23, 8, 40));
    expect(parseDate(" 2026-09-23T08:00:00Z ")).toBe(Date.UTC(2026, 8, 23, 8));
  });

  it("gives null for nothing or nonsense", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("  ")).toBeNull();
    expect(parseDate("someday")).toBeNull();
  });
});

describe("parseQuery", () => {
  it("splits words and quoted phrases, lower-cased", () => {
    expect(parseQuery('Diff  "Old Notes" metric').words).toEqual(["diff", "old notes", "metric"]);
    expect(parseQuery('"unclosed phrase').words).toEqual(["unclosed phrase"]);
    expect(parseQuery("   ").words).toEqual([]);
  });

  it("reads the core's filters", () => {
    const q = parseQuery("tag:Paper #idea project:Photo-Organiser type:card after:2026-09-01 before:2026-10-01 diff");
    expect(q.words).toEqual(["diff"]);
    expect(q.tags).toEqual(["paper", "idea"]);
    expect(q.projects).toEqual(["photo-organiser"]);
    expect(q.types).toEqual(["card"]);
    // Like the core, both days themselves are left out.
    expect(q.after).toBe(new Date(2026, 8, 2).getTime());
    expect(q.before).toBe(new Date(2026, 9, 1).getTime());
  });

  it("keeps a lone # or an empty filter as a word", () => {
    expect(parseQuery("# tag:").words).toEqual(["#", "tag:"]);
    expect(parseQuery("tag:#idea").tags).toEqual(["idea"]);
  });

  it("reads on:, created: and updated: with a day, a month, a year or a range", () => {
    const q = parseQuery("on:2026-09-23 created:2026-09 updated:2026-09-01..2026-09-30 notes");
    expect(q.words).toEqual(["notes"]);
    expect(q.on).toEqual({ from: new Date(2026, 8, 23).getTime(), to: new Date(2026, 8, 24).getTime() });
    expect(q.created).toEqual({ from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 9, 1).getTime() });
    expect(q.updated).toEqual({ from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 9, 1).getTime() });
    expect(parseQuery("created:2026").created).toEqual({ from: new Date(2026, 0, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
    expect(parseQuery("updated:2026-09-20..").updated).toEqual({ from: new Date(2026, 8, 20).getTime(), to: Number.POSITIVE_INFINITY });
  });

  it("keeps a value that is no date as a word, as the core does", () => {
    const q = parseQuery("on:soon created:2026-13-45 updated:");
    expect(q.words).toEqual(["on:soon", "created:2026-13-45", "updated:"]);
    expect([q.on, q.created, q.updated]).toEqual([null, null, null]);
  });
});

describe("filterRows", () => {
  it("keeps everything, in order, with no filters", () => {
    expect(filtered({})).toEqual(paths(ROWS));
  });

  it("filters by type", () => {
    expect(filtered({ kind: "card" })).toEqual(["call-the-printer.md", "diff-metric.md"]);
    expect(filtered({ kind: "project" })).toEqual(["_project.md"]);
    expect(filtered({ kind: "journal" })).toEqual(["2026-09-23.md"]);
    expect(filtered({ kind: "page" })).toEqual(["zettelkasten.md", "roadmap.md", "lost.md"]);
  });

  it("filters by project, inbox or loose pages", () => {
    expect(filtered({ place: "photo-organiser" })).toEqual(["_project.md", "diff-metric.md", "roadmap.md"]);
    expect(filtered({ place: INBOX })).toEqual(["call-the-printer.md"]);
    expect(filtered({ place: PAGES })).toEqual(["zettelkasten.md"]);
    expect(filtered({ place: "gone" })).toEqual([]);
  });

  it("filters by tag", () => {
    expect(filtered({ tag: "paper" })).toEqual(["diff-metric.md", "roadmap.md"]);
    expect(filtered({ tag: "reference" })).toEqual(["zettelkasten.md"]);
  });

  it("filters by when a note was updated", () => {
    expect(filtered({ updated: "today" })).toEqual(["call-the-printer.md"]);
    // The week starts on Monday the 21st.
    expect(filtered({ updated: "week" })).toEqual(["call-the-printer.md", "diff-metric.md", "lost.md", "2026-09-23.md"]);
    expect(filtered({ updated: "month" })).toEqual(["call-the-printer.md", "zettelkasten.md", "_project.md", "diff-metric.md", "lost.md", "2026-09-23.md"]);
  });

  it("filters by last week, last month, a chosen month and a custom range", () => {
    expect(filtered({ updated: "last-week" })).toEqual(["zettelkasten.md"]);
    expect(filtered({ updated: "last-month" })).toEqual(["roadmap.md"]);
    expect(filtered({ updated: "month:2026-08" })).toEqual(["roadmap.md"]);
    // The range's last day counts whole.
    expect(filtered({ updated: "range:2026-09-22..2026-09-23" })).toEqual(["diff-metric.md", "lost.md", "2026-09-23.md"]);
    expect(filtered({ updated: "range:2026-09-24.." })).toEqual(["call-the-printer.md"]);
  });

  it("starts 'this week' on the day the preferences say", () => {
    // Sunday 20 September is the first day of a Sunday week, and last week's last day on Monday.
    expect(filtered({ updated: "week" }, { weekStart: 0 })).toEqual(["call-the-printer.md", "zettelkasten.md", "diff-metric.md", "lost.md", "2026-09-23.md"]);
    expect(filtered({ updated: "week" }, { weekStart: 1 })).not.toContain("zettelkasten.md");
    expect(filtered({ updated: "last-week" }, { weekStart: 0 })).toEqual([]);
  });

  it("filters by when a note was made, leaving out notes with no created date", () => {
    expect(filtered({ created: "week" })).toEqual(["diff-metric.md", "2026-09-23.md"]);
    expect(filtered({ created: "month" })).toEqual(["zettelkasten.md", "_project.md", "diff-metric.md", "2026-09-23.md"]);
    expect(filtered({ created: "last-month" })).toEqual([]);
    expect(filtered({ created: "today", updated: "today" })).toEqual([]);
  });

  it("finds notes on no board, and orphans", () => {
    expect(filtered({ noBoard: true })).not.toContain("diff-metric.md");
    expect(filtered({ noBoard: true })).toContain("roadmap.md");
    // Notes the counts do not mention have no links and no boards.
    expect(filtered({ orphans: true })).toEqual(["call-the-printer.md", "_project.md", "lost.md", "2026-09-23.md"]);
  });

  it("ignores the board toggles until the counts have loaded", () => {
    expect(filtered({ orphans: true, noBoard: true }, { stats: null })).toEqual(paths(ROWS));
  });

  it("finds every word in the title, tags or excerpt", () => {
    expect(filtered({}, { query: parseQuery("DIFF") })).toEqual(["diff-metric.md"]);
    expect(filtered({}, { query: parseQuery("photo hash") })).toEqual(["diff-metric.md"]);
    expect(filtered({}, { query: parseQuery("reference") })).toEqual(["zettelkasten.md"]);
    expect(filtered({}, { query: parseQuery("photo poster") })).toEqual([]);
  });

  it("adds full-text matches, still under the filters", () => {
    const hits = new Set(["projects/photo-organiser/pages/roadmap.md", "inbox/call-the-printer.md"]);
    expect(filtered({}, { query: parseQuery("thumbnail"), hits })).toEqual(["call-the-printer.md", "roadmap.md"]);
    expect(filtered({ kind: "page" }, { query: parseQuery("thumbnail"), hits })).toEqual(["roadmap.md"]);
    expect(filtered({}, { query: parseQuery("thumbnail"), hits: new Map([["library/zettelkasten.md", {}]]) })).toEqual(["zettelkasten.md"]);
  });

  it("applies filters typed in the search box", () => {
    expect(filtered({}, { query: parseQuery("#paper") })).toEqual(["diff-metric.md", "roadmap.md"]);
    expect(filtered({}, { query: parseQuery("tag:paper tag:idea") })).toEqual(["diff-metric.md"]);
    expect(filtered({}, { query: parseQuery("type:card") })).toEqual(["call-the-printer.md", "diff-metric.md"]);
    expect(filtered({}, { query: parseQuery("project:photo-organiser type:page") })).toEqual(["roadmap.md"]);
    expect(filtered({}, { query: parseQuery("project:inbox") })).toEqual(["call-the-printer.md"]);
    expect(filtered({}, { query: parseQuery("after:2026-09-22 before:2026-09-24") })).toEqual(["diff-metric.md", "2026-09-23.md"]);
  });

  it("applies on:, created: and updated: typed in the search box", () => {
    // Made or changed on the day.
    expect(filtered({}, { query: parseQuery("on:2026-09-23") })).toEqual(["diff-metric.md", "2026-09-23.md"]);
    expect(filtered({}, { query: parseQuery("on:2026-09-02") })).toEqual(["zettelkasten.md"]);
    expect(filtered({}, { query: parseQuery("created:2026-09") })).toEqual(["zettelkasten.md", "_project.md", "diff-metric.md", "2026-09-23.md"]);
    expect(filtered({}, { query: parseQuery("updated:2026-08") })).toEqual(["roadmap.md"]);
    expect(filtered({}, { query: parseQuery("updated:2026-09-22..2026-09-23 type:card") })).toEqual(["diff-metric.md"]);
    // The old filters still work beside them.
    expect(filtered({}, { query: parseQuery("on:2026-09 after:2026-09-22") })).toEqual(["call-the-printer.md", "diff-metric.md", "2026-09-23.md"]);
  });
});

describe("sortRows", () => {
  const sorted = (key: Parameters<typeof sortRows>[1]["key"], dir: "asc" | "desc", stats: ReadonlyMap<string, NoteStats> | null = STATS) =>
    paths(sortRows(ROWS, { key, dir }, stats));

  it("sorts by updated, newest first or last", () => {
    const newest = sorted("updated", "desc");
    expect(newest.slice(0, 3)).toEqual(["call-the-printer.md", "2026-09-23.md", "diff-metric.md"]);
    expect(sorted("updated", "asc")).toEqual([...newest].reverse());
  });

  it("sorts by created, notes without a date last either way", () => {
    expect(sorted("created", "desc")).toEqual(["diff-metric.md", "2026-09-23.md", "zettelkasten.md", "_project.md", "call-the-printer.md", "lost.md", "roadmap.md"]);
    expect(sorted("created", "asc").slice(0, 4)).toEqual(["_project.md", "zettelkasten.md", "2026-09-23.md", "diff-metric.md"]);
    expect(sorted("created", "asc").slice(4)).toEqual(["call-the-printer.md", "lost.md", "roadmap.md"]);
  });

  it("sorts titles naturally, ignoring case", () => {
    const rows = buildRows([meta("library/b.md", { title: "card 10" }), meta("library/a.md", { title: "Card 2" }), meta("library/c.md", { title: "apple" })]);
    expect(sortRows(rows, { key: "title", dir: "asc" }, null).map((r) => r.title)).toEqual(["apple", "Card 2", "card 10"]);
    expect(sortRows(rows, { key: "title", dir: "desc" }, null).map((r) => r.title)).toEqual(["card 10", "Card 2", "apple"]);
  });

  it("puts the most linked first, then by outgoing links and title", () => {
    expect(sorted("backlinks", "desc").slice(0, 3)).toEqual(["roadmap.md", "diff-metric.md", "zettelkasten.md"]);
    // Without counts every note ties, so titles decide.
    expect(sorted("backlinks", "desc", null)).toEqual(sorted("title", "asc"));
  });

  it("sorts by boards, type, project and first tag", () => {
    expect(sorted("boards", "desc")[0]).toBe("diff-metric.md");
    expect(sorted("type", "asc")[0]).toBe("call-the-printer.md");
    expect(sorted("place", "asc").slice(0, 2)).toEqual(["call-the-printer.md", "2026-09-23.md"]);
    const byTag = sorted("tags", "asc");
    expect(byTag.slice(0, 4)).toEqual(["diff-metric.md", "roadmap.md", "zettelkasten.md", "call-the-printer.md"]);
    expect(sorted("tags", "desc").slice(-3)).toEqual(byTag.slice(-3));
  });

  it("breaks ties by title and path, and leaves the input alone", () => {
    const rows = buildRows([meta("library/b.md", { title: "Same" }), meta("library/a.md", { title: "Same" })]);
    expect(sortRows(rows, { key: "updated", dir: "desc" }, null).map((r) => r.path)).toEqual(["library/a.md", "library/b.md"]);
    expect(rows.map((r) => r.path)).toEqual(["library/b.md", "library/a.md"]);
  });
});

describe("helpers", () => {
  it("counts tags, most used first", () => {
    expect(tagCounts(ROWS)).toEqual([
      { tag: "paper", label: "paper", count: 2 },
      { tag: "idea", label: "idea", count: 1 },
      { tag: "reference", label: "Reference", count: 1 },
      { tag: "task", label: "task", count: 1 },
    ]);
  });

  it("starts the week on Monday", () => {
    const sunday = new Date(2026, 8, 27, 10).getTime();
    expect(updatedSince("week", sunday)).toBe(new Date(2026, 8, 21).getTime());
    expect(updatedSince("week", sunday, 0)).toBe(new Date(2026, 8, 27).getTime());
    const monday = new Date(2026, 8, 21, 10).getTime();
    expect(updatedSince("week", monday)).toBe(new Date(2026, 8, 21).getTime());
    expect(updatedSince("month", monday)).toBe(new Date(2026, 8, 1).getTime());
    expect(updatedSince("today", monday)).toBe(new Date(2026, 8, 21).getTime());
    expect(updatedSince("any", monday)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("knows when filters are set and how keys sort first", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, orphans: true })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, tag: "idea" })).toBe(true);
    expect(firstDir("updated")).toBe("desc");
    expect(firstDir("backlinks")).toBe("desc");
    expect(firstDir("title")).toBe("asc");
    expect(kindLabel("card")).toBe("Card");
    expect(kindLabel("")).toBe("Page");
  });
});
