import { describe, expect, it } from "vitest";

import type { NoteMeta, TagView } from "../../../lib/vault/types";
import { DEFAULT_COLUMNS, MAX_TABLES, addTable, cleanName, newTable, overviewProp, readOverview, readTable, removeTable, replaceTable, tableNotes, tableText } from "./overview";

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
  modified: 1,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});

const NOTES: NoteMeta[] = [
  note("projects/trip/pages/plan.md", { tags: ["paper"], updated: "2026-10-04T09:00:00Z" }),
  note("projects/trip/cards/idea.md", { kind: "card", tags: ["idea", "capture"], updated: "2026-10-02T09:00:00Z" }),
  note("projects/trip/pages/budget.md", { tags: ["paper"], updated: "2026-10-05T09:00:00Z" }),
  note("projects/trip/_project.md", { kind: "project", updated: "2026-10-07T09:00:00Z" }),
  note("projects/work/pages/report.md", { project: "work", tags: ["paper"], updated: "2026-10-06T09:00:00Z" }),
  note("library/notes.md", { project: null }),
  note("templates/page.md", { kind: "template", project: null }),
];

const paths = (list: NoteMeta[]) => list.map((n) => n.path);

describe("a project's saved tables", () => {
  it("reads the tables kept in the overview property, in order, leaving out what cannot be read", () => {
    const props = {
      overview: [
        JSON.stringify({ name: "Papers", filter: [{ key: "tags", op: "contains", value: "paper" }], columns: ["tags"], sort: [{ key: "updated", dir: "desc" }] }),
        "not json",
        JSON.stringify({ filter: [] }),
        JSON.stringify({ name: "papers" }),
        42,
        JSON.stringify({ name: "Vault wide", scope: "vault", extra: { kept: true } }),
      ],
    };
    const { tables } = readOverview(props);
    expect(tables.map((t) => t.name)).toEqual(["Papers", "Vault wide"]);
    expect(tables[0]).toMatchObject({ type: "table", scope: "project", columns: ["tags"], filter: [{ key: "tags", op: "contains", value: "paper" }] });
    expect(tables[1]).toMatchObject({ scope: "vault", extra: { kept: true } });
    expect(readOverview({}).tables).toEqual([]);
    expect(readOverview(null).tables).toEqual([]);
    expect(readOverview({ overview: "a string" }).tables).toEqual([]);
  });

  it("writes tables back as the lines it read, and nothing when there are none", () => {
    const original = [JSON.stringify({ name: "Papers", type: "table", scope: "project", filter: [{ key: "tags", op: "contains", value: "paper" }], sort: [{ key: "updated", dir: "desc" }], columns: ["tags"], extra: 1 })];
    const overview = readOverview({ overview: original });
    expect(overviewProp(overview)).toEqual(original);
    expect(readOverview({ overview: overviewProp(overview) })).toEqual(overview);
    expect(overviewProp({ tables: [] })).toBeNull();
    // The text is plain, one line each.
    expect(tableText(newTable({ tables: [] }))).not.toContain("\n");
  });

  it("makes a new table with a name no other table has", () => {
    const first = newTable({ tables: [] });
    expect(first).toEqual({ name: "Table", type: "table", scope: "project", filter: [], sort: [{ key: "updated", dir: "desc" }], columns: [...DEFAULT_COLUMNS] });
    const two = addTable({ tables: [first] }, newTable({ tables: [first] }, "table"));
    // A name is kept as typed; only the number is added.
    expect(two.tables.map((t) => t.name)).toEqual(["Table", "table 2"]);
    expect(addTable(two, { ...first, name: "TABLE" }).tables.map((t) => t.name)).toEqual(["Table", "table 2", "TABLE 3"]);
    expect(newTable({ tables: [] }, "  Open [papers] | now  ").name).toBe("Open papers now");
    expect(cleanName("x".repeat(100))).toHaveLength(60);
  });

  it("keeps no more tables than the limit", () => {
    let overview = { tables: [] as TagView[] };
    for (let n = 0; n < MAX_TABLES + 3; n++) overview = addTable(overview, newTable(overview, `T${n}`));
    expect(overview.tables).toHaveLength(MAX_TABLES);
    const lines = Array.from({ length: MAX_TABLES + 5 }, (_, n) => JSON.stringify({ name: `T${n}` }));
    expect(readOverview({ overview: lines }).tables).toHaveLength(MAX_TABLES);
  });

  it("renames, replaces and removes a table without making two share a name", () => {
    const a = newTable({ tables: [] }, "A");
    const b = newTable({ tables: [a] }, "B");
    const overview = { tables: [a, b] };
    expect(replaceTable(overview, "a", { ...a, filter: [{ key: "type", op: "is", value: "card" }] }).tables[0]!.filter).toEqual([{ key: "type", op: "is", value: "card" }]);
    expect(replaceTable(overview, "A", { ...a, name: "Cards" }).tables.map((t) => t.name)).toEqual(["Cards", "B"]);
    expect(replaceTable(overview, "A", { ...a, name: "b" }).tables.map((t) => t.name)).toEqual(["b 2", "B"]);
    expect(replaceTable(overview, "A", { ...a, name: "  " }).tables.map((t) => t.name)).toEqual(["A", "B"]);
    expect(removeTable(overview, "a").tables.map((t) => t.name)).toEqual(["B"]);
    expect(removeTable(overview, "nope")).toEqual(overview);
  });

  it("reads one table's text", () => {
    expect(readTable(JSON.stringify({ name: "X" }))).toMatchObject({ name: "X", type: "table", scope: "project" });
    expect(readTable(JSON.stringify({ name: "X", type: "kanban" }))!.type).toBe("table");
    expect(readTable("[]")).toBeNull();
    expect(readTable(null)).toBeNull();
  });
});

describe("what a saved table lists", () => {
  const table = (over: Partial<TagView>) => newTable({ tables: [] }, "T", over);

  it("lists the notes of its project, newest first, and nothing from outside", () => {
    expect(paths(tableNotes(NOTES, table({}), "trip"))).toEqual(["projects/trip/pages/budget.md", "projects/trip/pages/plan.md", "projects/trip/cards/idea.md"]);
    expect(tableNotes(NOTES, table({}), "none")).toEqual([]);
  });

  it("filters by the built-in keys: tags, type, project, and dates", () => {
    expect(paths(tableNotes(NOTES, table({ filter: [{ key: "tags", op: "contains", value: "paper" }] }), "trip"))).toEqual(["projects/trip/pages/budget.md", "projects/trip/pages/plan.md"]);
    expect(paths(tableNotes(NOTES, table({ filter: [{ key: "tags", op: "is", value: "capture" }] }), "trip"))).toEqual(["projects/trip/cards/idea.md"]);
    expect(paths(tableNotes(NOTES, table({ filter: [{ key: "type", op: "is", value: "card" }] }), "trip"))).toEqual(["projects/trip/cards/idea.md"]);
    expect(paths(tableNotes(NOTES, table({ filter: [{ key: "updated", op: "after", value: "2026-10-03" }] }), "trip"))).toEqual(["projects/trip/pages/budget.md", "projects/trip/pages/plan.md"]);
    expect(paths(tableNotes(NOTES, table({ filter: [{ key: "tags", op: "empty" }] }), "trip"))).toEqual([]);
  });

  it("can reach the whole vault, and then a filter by project narrows it", () => {
    const wide = table({ scope: "vault", filter: [{ key: "project", op: "is", value: "work" }] });
    expect(paths(tableNotes(NOTES, wide, "trip"))).toEqual(["projects/work/pages/report.md"]);
    // Every note but templates, the project's own page too.
    expect(paths(tableNotes(NOTES, table({ scope: "vault", sort: [{ key: "title", dir: "asc" }] }), "trip"))).toEqual(["projects/trip/_project.md", "projects/trip/pages/budget.md", "projects/trip/cards/idea.md", "library/notes.md", "projects/trip/pages/plan.md", "projects/work/pages/report.md"]);
  });

  it("sorts by a built-in key either way", () => {
    expect(paths(tableNotes(NOTES, table({ sort: [{ key: "type", dir: "asc" }] }), "trip"))).toEqual(["projects/trip/cards/idea.md", "projects/trip/pages/budget.md", "projects/trip/pages/plan.md"]);
    expect(paths(tableNotes(NOTES, table({ sort: [{ key: "tags", dir: "desc" }] }), "trip"))[0]).toBe("projects/trip/pages/budget.md");
  });
});
