import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { buildRows, type Sort } from "./filters";
import { groupRows, limitGroups, readGroupBy, shownRows } from "./groups";

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

const NOTES = [
  meta("projects/p1/cards/a.md", { title: "A", kind: "card", tags: ["Alpha"], created: "2026-08-05", updated: "2026-09-03" }),
  meta("library/b.md", { title: "B", tags: ["beta", "alpha"], created: "2026-09-10", updated: "2026-09-12" }),
  meta("library/c.md", { title: "C", updated: "2026-09-14" }),
  meta("journal/2026/2026-10-01.md", { title: "Daily", kind: "journal", updated: "2026-10-01" }),
  meta("inbox/e.md", { title: "E", kind: "card", tags: ["Alpha"], updated: "2026-09-20" }),
];
const ROWS = buildRows(NOTES);
const UPDATED: Sort = { key: "updated", dir: "desc" };
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
const heads = (by: Parameters<typeof groupRows>[1], sort: Sort = UPDATED, weekStart = 1) => groupRows(ROWS, by, { sort, weekStart }).map((g) => [g.label, titles(g.rows)]);

describe("groupRows", () => {
  it("is one group with no heading without grouping", () => {
    const groups = groupRows(ROWS, "none", { sort: UPDATED });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "", label: "", count: 5, folded: false });
    expect(shownRows(groups)).toEqual(ROWS);
  });

  it("groups by type in the order of the type filter, keeping each group's order", () => {
    expect(heads("type")).toEqual([
      ["Cards", ["A", "E"]],
      ["Pages", ["B", "C"]],
      ["Journal", ["Daily"]],
    ]);
  });

  it("groups by project, inbox or loose pages, by name", () => {
    expect(heads("project").map(([label]) => label)).toEqual(["Inbox", "Journal", "p1", "Pages"]);
  });

  it("groups by first tag, notes with none last", () => {
    expect(heads("tag")).toEqual([
      ["#Alpha", ["A", "E"]],
      ["#beta", ["B"]],
      ["No tag", ["C", "Daily"]],
    ]);
  });

  it("groups by the month of when each was last changed, newest month first", () => {
    const groups = groupRows(ROWS, "month", { sort: UPDATED });
    expect(groups.map((g) => g.key)).toEqual(["month:2026-10", "month:2026-09"]);
    expect(groups.map((g) => g.label)).toEqual([new Date(2026, 9, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), new Date(2026, 8, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })]);
    expect(titles(groups[1]!.rows)).toEqual(["A", "B", "C", "E"]);
  });

  it("groups by the month of when each was made when sorted by that, notes with no date last", () => {
    const sort: Sort = { key: "created", dir: "asc" };
    const groups = groupRows(ROWS, "month", { sort });
    expect(groups.map((g) => g.key)).toEqual(["month:2026-08", "month:2026-09", "month:"]);
    expect(groups.map((g) => g.label).at(-1)).toBe("No date");
    expect(titles(groups.at(-1)!.rows)).toEqual(["C", "Daily", "E"]);
    // Newest first when sorted newest first.
    expect(groupRows(ROWS, "month", { sort: { key: "created", dir: "desc" } }).map((g) => g.key)).toEqual(["month:2026-09", "month:2026-08", "month:"]);
  });

  it("groups by the week, which starts on the day the preferences say", () => {
    // 2026-09-12 is a Saturday, 2026-09-14 a Monday, 2026-09-20 a Sunday.
    const monday = groupRows(ROWS, "week", { sort: UPDATED, weekStart: 1 });
    expect(monday.map((g) => g.key)).toEqual(["week:2026-09-28", "week:2026-09-14", "week:2026-09-07", "week:2026-08-31"]);
    expect(titles(monday.find((g) => g.key === "week:2026-09-14")!.rows)).toEqual(["C", "E"]);
    const sunday = groupRows(ROWS, "week", { sort: UPDATED, weekStart: 0 });
    expect(sunday.map((g) => g.key)).toEqual(["week:2026-09-27", "week:2026-09-20", "week:2026-09-13", "week:2026-09-06", "week:2026-08-30"]);
    expect(titles(sunday.find((g) => g.key === "week:2026-09-20")!.rows)).toEqual(["E"]);
    expect(monday[0]!.label).toMatch(/^Week of /);
  });

  it("leaves a folded group's cards out but still counts them", () => {
    const groups = groupRows(ROWS, "type", { sort: UPDATED }, new Set(["type:card"]));
    expect(groups[0]).toMatchObject({ key: "type:card", rows: [], count: 2, folded: true });
    expect(titles(shownRows(groups))).toEqual(["B", "C", "Daily"]);
  });
});

describe("limitGroups", () => {
  it("cuts the cards drawn at the limit, keeping every heading", () => {
    const groups = groupRows(ROWS, "type", { sort: UPDATED });
    const limited = limitGroups(groups, 3);
    expect(limited.map((g) => g.rows.length)).toEqual([2, 1, 0]);
    expect(limited.map((g) => g.count)).toEqual([2, 2, 1]);
    expect(limitGroups(groups, 100)).toEqual(groups);
  });
});

describe("readGroupBy", () => {
  it("keeps a known grouping and drops the rest", () => {
    expect(readGroupBy("week")).toBe("week");
    expect(readGroupBy("colour")).toBe("none");
    expect(readGroupBy(undefined)).toBe("none");
  });
});
