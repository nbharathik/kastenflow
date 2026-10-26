import { describe, expect, it } from "vitest";

import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { tableColumns } from "./columns";
import { parseCell, pasteNotice, planPaste, type PasteInput } from "./paste-plan";

const SCHEMA: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  views: [],
  properties: [
    { key: "status", type: "select", options: ["Todo", "Doing", "Done"] },
    { key: "due", type: "date", options: [] },
    { key: "points", type: "number", options: [] },
    { key: "urgent", type: "checkbox", options: [] },
    { key: "summary", type: "text", options: [] },
    { key: "link", type: "url", options: [] },
    { key: "labels", type: "multi_select", options: ["ui", "core"] },
    { key: "blocks", type: "relation", options: [] },
    { key: "score", type: "formula", options: [], formula: "points * 2" },
  ],
};
const VIEW: TagView = { name: "All", type: "table" };
const columns = tableColumns(VIEW, SCHEMA);
const col = (key: string) => columns.findIndex((c) => c.key === key);
const def = (key: string) => SCHEMA.properties.find((p) => p.key === key)!;

function note(path: string, title: string, props: Record<string, unknown> = {}): NoteMeta {
  return {
    path, id: `n-${title}`, title, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["task"],
    modified: 0, created: null, updated: null, excerpt: "", words: 0, props, locked: false,
  };
}
const NOTES = [note("a.md", "Alpha", { status: "Todo", points: 1 }), note("b.md", "Beta", { status: "Doing" }), note("c.md", "Gamma")];

function plan(grid: string[][], at = { row: 0, col: 0 }, more: Partial<PasteInput> = {}) {
  return planPaste({ grid, at, columns, notes: NOTES, tag: "task", fill: {}, home: null, canAdd: true, ...more });
}

describe("one cell, by the column's type", () => {
  it.each([
    ["text", "summary", " Window seats ", "Window seats"],
    ["url", "link", "https://example.com/a", "https://example.com/a"],
    ["url", "link", "mailto:me@example.com", "mailto:me@example.com"],
    ["number", "points", "3", 3],
    ["number", "points", " 2.5 ", 2.5],
    ["number", "points", "-4", -4],
    ["number", "points", "1,250", 1250],
    ["number", "points", "1,250.75", 1250.75],
    ["date", "due", "2026-10-02", "2026-10-02"],
    ["date", "due", "2026-10-02 09:30", "2026-10-02T09:30"],
    ["date", "due", "2026/10/2", "2026-10-02"],
    ["date", "due", "2 Oct 2026", "2026-10-02"],
    ["date", "due", "October 2, 2026", "2026-10-02"],
    ["date", "due", "Oct 2 2026", "2026-10-02"],
    ["checkbox", "urgent", "TRUE", true],
    ["checkbox", "urgent", "yes", true],
    ["checkbox", "urgent", "1", true],
    ["checkbox", "urgent", "x", true],
    ["checkbox", "urgent", "false", false],
    ["checkbox", "urgent", "No", false],
    ["checkbox", "urgent", "0", false],
    ["select", "status", "done", "Done"],
    ["select", "status", " Doing ", "Doing"],
    ["multi_select", "labels", "ui, core", ["ui", "core"]],
    ["multi_select", "labels", "CORE;ui", ["core", "ui"]],
    ["multi_select", "labels", "ui, ui", ["ui"]],
  ])("%s %s %j", (_type, key, text, value) => {
    expect(parseCell(def(key), text)).toEqual({ value, bad: [] });
  });

  it.each([
    ["number", "points", "abc"],
    ["number", "points", "1,2"],
    ["number", "points", "Infinity"],
    ["date", "due", "13/13/2026"],
    ["date", "due", "2026-02-30"],
    ["date", "due", "soon"],
    ["date", "due", "10/2/2026"],
    ["checkbox", "urgent", "maybe"],
    ["select", "status", "Blocked"],
    ["url", "link", "example.com"],
  ])("leaves %s %s %j out and names it", (_type, key, text) => {
    expect(parseCell(def(key), text)).toEqual({ value: undefined, bad: [text.trim()] });
  });

  it("keeps the options of a multi-select that fit and names the rest", () => {
    expect(parseCell(def("labels"), "ui, nope, core, other")).toEqual({ value: ["ui", "core"], bad: ["nope", "other"] });
    expect(parseCell(def("labels"), "nope")).toEqual({ value: undefined, bad: ["nope"] });
  });

  it("takes any text for a select that has no options", () => {
    expect(parseCell({ key: "kind", type: "select", options: [] }, "Anything")).toEqual({ value: "Anything", bad: [] });
  });

  it("clears the value for an empty cell", () => {
    for (const key of ["status", "due", "points", "urgent", "summary", "link", "labels"]) {
      expect(parseCell(def(key), "  ")).toEqual({ value: null, bad: [] });
    }
  });
});

describe("filling existing rows", () => {
  it("writes each row's cells in one update, from the active cell on", () => {
    const p = plan([["Done", "2026-10-05"], ["Todo", ""]], { row: 1, col: col("status") });
    expect(p.changes).toEqual([
      { kind: "update_props", path: "b.md", props: { status: "Done", due: "2026-10-05" } },
      // An empty cell clears a value; there is none to clear in Gamma's due.
      { kind: "update_props", path: "c.md", props: { status: "Todo" } },
    ]);
    expect(p.added).toBe(0);
    expect(p.touched).toBe(2);
  });

  it("renames a row when the title column is pasted, after its properties", () => {
    const p = plan([["Alpha 2", "Done"]]);
    expect(p.changes).toEqual([
      { kind: "update_props", path: "a.md", props: { status: "Done" } },
      { kind: "rename", path: "a.md", title: "Alpha 2" },
    ]);
  });

  it("leaves out what is already there", () => {
    const p = plan([["Alpha", "Todo", ""]]);
    // status is Todo already, the title is the same, due is empty and stays empty.
    expect(p.changes).toEqual([]);
    expect(p.touched).toBe(0);
  });

  it("does not touch a cell the row did not have (ragged rows)", () => {
    const p = plan([["Done"], ["Done", "2026-10-02"]], { row: 0, col: col("status") });
    expect(p.changes).toEqual([
      { kind: "update_props", path: "a.md", props: { status: "Done" } },
      { kind: "update_props", path: "b.md", props: { status: "Done", due: "2026-10-02" } },
    ]);
  });

  it("does not write the title when it is empty", () => {
    expect(plan([[""]]).changes).toEqual([]);
  });
});

describe("cells that cannot take a paste", () => {
  it("skips calculated, relation and built-in columns and names them", () => {
    const wide = tableColumns({ ...VIEW, columns: ["status", "blocks", "score", "created"] }, SCHEMA);
    const p = planPaste({ grid: [["Done", "x", "9", "2026-01-01"]], at: { row: 0, col: 1 }, columns: wide, notes: NOTES, tag: "task", fill: {}, home: null, canAdd: true });
    expect(p.changes).toEqual([{ kind: "update_props", path: "a.md", props: { status: "Done" } }]);
    expect(p.skippedColumns).toEqual(["blocks", "score", "created"]);
    expect(pasteNotice(p)).toContain("blocks, score and created");
  });

  it("names a value that does not fit and leaves the cell as it was", () => {
    const p = plan([["abc"]], { row: 0, col: col("points") });
    expect(p.changes).toEqual([]);
    expect(p.invalid).toEqual([{ value: "abc", column: "points", row: 1 }]);
    expect(pasteNotice(p)).toContain("Nothing was pasted");
  });

  it("drops columns past the table's last and says how many", () => {
    const p = plan([["Done", "2026-10-02", "x", "y", "z", "q", "r", "s", "t", "u", "v", "w"]], { row: 0, col: col("status") });
    expect(p.leftOutColumns).toBeGreaterThan(0);
    expect(pasteNotice(p)).toMatch(/column/);
  });
});

describe("adding rows", () => {
  it("makes a page for each pasted row past the last, carrying the tag", () => {
    const p = plan([["Done"], ["Todo"], ["Doing"]], { row: 2, col: col("status") });
    expect(p.changes).toEqual([
      { kind: "update_props", path: "c.md", props: { status: "Done" } },
      { kind: "create_note", type: "page", title: "Untitled", tags: ["task"], props: { status: "Todo" } },
      { kind: "create_note", type: "page", title: "Untitled", tags: ["task"], props: { status: "Doing" } },
    ]);
    expect(p.added).toBe(2);
  });

  it("takes the title from the first column, and the view's implied values and home", () => {
    const p = plan([["Delta", "Done"]], { row: 3, col: 0 }, { fill: { urgent: true }, home: { project: "web", parent: "pages/hub.md" } });
    expect(p.changes).toEqual([
      { kind: "create_note", type: "page", title: "Delta", tags: ["task"], props: { urgent: true, status: "Done" }, parent: "pages/hub.md", project: "web" },
    ]);
  });

  it("does not make a row out of an empty line", () => {
    const p = plan([["Delta"], ["", ""]], { row: 3, col: 0 });
    expect(p.added).toBe(1);
  });

  it("makes no rows in a table that is not one tag's, and says so", () => {
    const p = plan([["Done"], ["Todo"]], { row: 2, col: col("status") }, { canAdd: false });
    expect(p.changes).toHaveLength(1);
    expect(p.leftOutRows).toBe(1);
    expect(pasteNotice(p)).toContain("1 row past the last");
  });

  it("leaves out an invalid value of a new row, empty", () => {
    const p = plan([["Delta", "Blocked"]], { row: 3, col: 0 });
    expect(p.changes).toEqual([{ kind: "create_note", type: "page", title: "Delta", tags: ["task"], props: {} }]);
    expect(p.invalid).toEqual([{ value: "Blocked", column: "status", row: 1 }]);
  });
});

describe("a 20 by 5 block", () => {
  it("is twenty changes, ready for one batch", () => {
    const grid = Array.from({ length: 20 }, (_, i) => [`Task ${i}`, i % 2 ? "Done" : "Todo", `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, String(i), i % 3 ? "no" : "yes"]);
    const p = plan(grid, { row: 0, col: 0 });
    // Three rows exist; renames and updates come for those, pages for the other 17.
    expect(p.added).toBe(17);
    expect(p.cutRows).toBe(0);
    expect(p.cells).toBe(100);
    expect(p.invalid).toEqual([]);
    expect(p.changes.length).toBeLessThanOrEqual(100);
  });
});

describe("how much one paste may hold", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [`New ${i}`]);

  it("keeps the rows that fit in 100 changes and counts the rest", () => {
    const p = plan(rows(150), { row: 3, col: 0 });
    expect(p.changes).toHaveLength(100);
    expect(p.added).toBe(100);
    expect(p.cutRows).toBe(50);
    expect(p.keptRows).toBe(100);
  });

  it("counts two changes for a row that is renamed and changed", () => {
    const grid = [["A1", "Done"], ["B1", "Done"], ["C1", "Done"]];
    expect(plan(grid).changes).toHaveLength(6);
    const p = plan(grid, { row: 0, col: 0 }, { maxChanges: 5 });
    expect(p.changes).toHaveLength(4);
    expect(p.cutRows).toBe(1);
  });

  it("refuses more than a thousand rows with one sentence", () => {
    const p = plan(rows(1001), { row: 3, col: 0 });
    expect(p.changes).toEqual([]);
    expect(p.refused).toBe("A paste can hold up to 1,000 rows and this one has 1,001. Paste it in smaller parts.");
  });

  it("says how many it can paste when the rest does not fit", () => {
    const p = plan(rows(150), { row: 3, col: 0 });
    expect(pasteNotice(p)).toContain("100 of 150 rows");
  });
});

describe("the notice", () => {
  it("counts rows and new rows", () => {
    const p = plan([["Alpha 2"], ["Beta 2"], ["Gamma 2"], ["Delta"]]);
    expect(pasteNotice(p)).toBe("Pasted 4 rows (1 new)");
    expect(pasteNotice(plan([["Alpha 2"]]))).toBe("Pasted 1 row");
  });

  it("names up to three values that did not fit", () => {
    const p = plan([["a"], ["b"], ["c"], ["d"]], { row: 0, col: col("points") });
    const text = pasteNotice(p);
    expect(text).toContain("4 values did not fit and were left empty");
    expect(text).toContain("“a” in points");
    expect(text).toContain("and 1 more");
    expect(text).not.toContain("“d”");
  });

  it("is empty-handed when nothing changed", () => {
    expect(pasteNotice(plan([["Alpha"]]))).toBe("Nothing changed: the cells already held those values");
  });
});
