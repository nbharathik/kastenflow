// The changes the table's UI sends the core, compared with the JSON file the
// core's own test (crates/kasten-core/tests/core/table_wire.rs) feeds to a real
// batch. If either side renames a field or a kind, one of the two tests fails.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createPage, ref, viewOrder } from "../../../../lib/vault/batch-changes";
import type { BatchChange } from "../../../../lib/vault/batch-types";
import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { addToBoardChanges, moveChanges, removeTagChanges, setPropertyChanges, tagChanges } from "./bulk-changes";
import { tableColumns } from "./columns";
import { reorderIds } from "./manual-order";
import { planPaste, type PasteInput } from "./paste-plan";

interface Case {
  name: string;
  changes: BatchChange[];
}
// Vitest runs from the app folder.
const file = resolve(process.cwd(), "../fixtures/table-wire/table-wire.json");
const fixture = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };
const wanted = (name: string) => {
  const found = fixture.cases.find((c) => c.name === name);
  if (!found) throw new Error(`no case “${name}” in the fixture`);
  return found.changes;
};

const SCHEMA: TagSchema = {
  name: "travel",
  color: null,
  path: "tags/travel.yaml",
  views: [],
  properties: [
    { key: "status", type: "select", options: ["Idea", "Planning", "Booked", "Done"] },
    { key: "start", type: "date", options: [] },
    { key: "end", type: "date", options: [] },
    { key: "budget", type: "number", options: [] },
  ],
};
const VIEW: TagView = { name: "Trips", type: "table" };
const columns = tableColumns(VIEW, SCHEMA);

function note(title: string, tags: string[], props: Record<string, unknown>, project: string | null = null): NoteMeta {
  return {
    path: `@path:${title}`, id: `@id:${title}`, title, kind: "page", icon: null, cover: null, parent: null, project, tags,
    modified: 0, created: null, updated: null, excerpt: "", words: 0, props, locked: false,
  };
}
const ALPHA = note("Alpha", ["travel"], { status: "Idea", budget: 100 });
const BETA = note("Beta", ["travel"], { status: "Booked", budget: 250 });
const GAMMA = note("Gamma", ["travel", "idea"], {});
const ALL = [ALPHA, BETA, GAMMA];

function paste(grid: string[][], at: { row: number; col: number }, notes: NoteMeta[], more: Partial<PasteInput> = {}) {
  return planPaste({ grid, at, columns, notes, tag: "travel", fill: {}, home: null, canAdd: true, ...more }).changes;
}

describe("the table's changes are the ones the core is tested with", () => {
  it("set a property on two rows", () => {
    expect(setPropertyChanges([ALPHA, GAMMA], "status", "Planning").changes).toEqual(wanted("set a property on two rows"));
  });

  it("clear a property", () => {
    expect(setPropertyChanges([ALPHA], "status", null).changes).toEqual(wanted("clear a property"));
  });

  it("set a number and a date (a paste into two cells)", () => {
    // Columns: title, status, start, end, budget. Status keeps its value and
    // the empty end cell matches the row's missing end, so two cells change.
    const cell: Record<string, string> = { status: "Booked", start: "2026-10-02", end: "", budget: "300" };
    const grid = columns.slice(1).map((c) => cell[c.key] ?? "");
    expect(paste([grid], { row: 1, col: 1 }, ALL)).toEqual(wanted("set a number and a date"));
  });

  it("add and remove a tag", () => {
    expect(tagChanges([GAMMA], "review").changes).toEqual(wanted("add a tag"));
    expect(removeTagChanges([GAMMA], "idea").changes).toEqual(wanted("remove a tag"));
  });

  it("move rows to a project, and back to the library", () => {
    expect(moveChanges([ALPHA, BETA], ALL, "photo-organiser").changes).toEqual(wanted("move rows to a project"));
    const inProject = note("Alpha", ["travel"], { status: "Idea", budget: 100 }, "photo-organiser");
    expect(moveChanges([inProject], [inProject, BETA, GAMMA], null).changes).toEqual(wanted("move a row back to the library"));
  });

  it("add rows to a board", () => {
    expect(addToBoardChanges("projects/photo-organiser/boards/brainstorm.canvas", [ALPHA, BETA])).toEqual(wanted("add rows to a board"));
  });

  it("paste over an existing row, with a new title", () => {
    const grid = [["Alpha prime", "Booked", ...columns.slice(2).map((c) => (c.key === "budget" ? "120" : ""))]];
    const only = columns.slice(1).map((c) => c.key);
    expect(only).toContain("budget");
    // Blank cells clear values the row holds; the row has none beyond budget and status.
    expect(paste(grid, { row: 0, col: 0 }, [ALPHA])).toEqual(wanted("paste over an existing row"));
  });

  it("paste new rows, into a project, and under a page", () => {
    const row = (title: string, status: string, budget: string) => columns.map((c) => (c.key === "title" ? title : c.key === "status" ? status : c.key === "budget" ? budget : ""));
    expect(paste([row("Delta", "Idea", "5"), row("", "Done", "")], { row: 0, col: 0 }, [])).toEqual(wanted("paste new rows"));
    expect(paste([row("Delta", "", "5")], { row: 0, col: 0 }, [], { home: { project: "photo-organiser", parent: null } })).toEqual(wanted("paste new rows into a project"));
    expect(paste([row("Delta", "", "5")], { row: 0, col: 0 }, [], { home: { project: null, parent: "@path:Alpha" } })).toEqual(wanted("paste new rows under a page"));
  });

  it("put rows in order by hand", () => {
    const ids = reorderIds(ALL, ALL, 2, 0);
    expect(ids).not.toBeNull();
    expect([viewOrder("travel", "Trips", ids!)]).toEqual(wanted("put rows in order by hand"));
  });

  it("a page made and then named by the next changes", () => {
    const built = [
      createPage({ title: "Parent", tags: ["travel"], props: {} }),
      createPage({ title: "Child", tags: ["travel"], props: {}, parent: ref(0) }),
      { kind: "update_props", path: ref(1), props: { budget: 9 } },
    ];
    expect(built).toEqual(wanted("a page made and then named by the next changes"));
  });
});
