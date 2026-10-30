// What a table becomes as a database, and what Copy as CSV writes.

import { describe, expect, it } from "vitest";

import { BATCH_LIMITS } from "../../../../lib/vault/batch-types";
import { toCsv } from "./csv";
import { databaseChanges, guessKind, MAX_ROWS, noteChanges, planDatabase } from "./database";

describe("Copy as CSV", () => {
  it("writes lines of fields ended by CRLF", () => {
    expect(toCsv({ header: ["Name", "Qty"], rows: [["apple", "3"], ["pear", "12"]] })).toBe("Name,Qty\r\napple,3\r\npear,12");
  });

  it("quotes a field with a comma, a quote or a line break, and doubles quotes inside", () => {
    const csv = toCsv({ header: ["a,b", 'say "hi"', "two\nlines"], rows: [["plain", " spaced ", ""]] });
    expect(csv).toBe('"a,b","say ""hi""","two\nlines"\r\nplain, spaced ,');
  });

  it("keeps empty cells as empty fields", () => {
    expect(toCsv({ header: ["a", "b"], rows: [["", ""]] })).toBe("a,b\r\n,");
  });
});

describe("guessing a column's type", () => {
  it.each([
    [["1", "2.5", "-3", ""], "number"],
    [["2026-01-31", "2024-02-29"], "date"],
    [["2026-02-30"], "text"],
    [["yes", "No", "TRUE"], "checkbox"],
    [["✓", "✗"], "checkbox"],
    [["1", "two"], "text"],
    [["1,200"], "text"],
    [[], "text"],
    [["", " "], "text"],
    [["x", "y"], "text"],
  ])("%j is %s", (cells, kind) => {
    expect(guessKind(cells)).toBe(kind);
  });
});

describe("planning the database", () => {
  const grid = {
    header: ["Item", "Qty", "Due", "Packed", "Note"],
    rows: [
      ["apple", "3", "2026-03-01", "yes", "red"],
      ["pear", "12", "", "no", ""],
    ],
  };

  it("makes the tag, a property for each column after the first, and a note for each row", () => {
    const plan = planDatabase(grid, "Fruit stand");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.tag).toBe("fruit-stand");
    expect(plan.properties).toEqual([
      { key: "Qty", type: "number", options: [] },
      { key: "Due", type: "date", options: [] },
      { key: "Packed", type: "checkbox", options: [] },
      { key: "Note", type: "text", options: [] },
    ]);
    expect(plan.notes).toEqual([
      { title: "apple", props: { Qty: 3, Due: "2026-03-01", Packed: true, Note: "red" } },
      { title: "pear", props: { Qty: 12, Packed: false } },
    ]);
  });

  it("names unnamed and repeated headers so every key is its own", () => {
    const plan = planDatabase({ header: ["T", "", "A:b", "a b", "A B"], rows: [["x", "1", "2", "3", "4"]] }, "t");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.properties.map((p) => p.key)).toEqual(["Column 2", "A b", "a b 2", "A B 3"]);
  });

  it("titles a row with no first cell by its number", () => {
    const plan = planDatabase({ header: ["T", "V"], rows: [["", "1"], ["b", "2"]] }, "t");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.notes.map((n) => n.title)).toEqual(["Row 1", "b"]);
  });

  it("says why not, in one sentence, and plans nothing", () => {
    expect(planDatabase(grid, "  ")).toEqual({ error: "Give the database a name with letters or numbers in it." });
    expect(planDatabase(grid, "!!!")).toHaveProperty("error");
    expect(planDatabase({ header: ["T"], rows: [] }, "x")).toEqual({ error: "This table has no rows to turn into notes." });
    const big = planDatabase({ header: ["T"], rows: Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`r${i}`]) }, "x");
    expect(big).toHaveProperty("error");
    expect(planDatabase({ header: ["T"], rows: Array.from({ length: MAX_ROWS }, (_, i) => [`r${i}`]) }, "x")).not.toHaveProperty("error");
  });

  it("writes a note for each row, a sub-page of the page that holds the table", () => {
    const plan = planDatabase(grid, "Fruit");
    if ("error" in plan) throw new Error(plan.error);
    const changes = noteChanges(plan, { parent: "library/Stand.md" });
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual({ kind: "create_note", type: "page", title: "pear", tags: ["fruit"], props: { Qty: 12, Packed: false }, parent: "library/Stand.md" });
  });

  it("puts the notes in the project of a note that holds no pages", () => {
    const plan = planDatabase(grid, "Fruit");
    if ("error" in plan) throw new Error(plan.error);
    expect(noteChanges(plan, { project: "market" })[0]).toMatchObject({ project: "market" });
    expect(noteChanges(plan, { project: "market" })[0]).not.toHaveProperty("parent");
    expect(noteChanges(plan, { project: null })[0]).not.toHaveProperty("project");
  });

  it("is one batch: the schema first, then the notes, then the page with the table swapped for the embed", () => {
    const plan = planDatabase(grid, "Fruit");
    if ("error" in plan) throw new Error(plan.error);
    const changes = databaseChanges(plan, { parent: "library/Stand.md" }, { path: "library/Stand.md", block: { id: "b3", hash: "abc123" } }, "tags/fruit.yaml");
    expect(changes.map((c) => c.kind)).toEqual(["tag_schema", "create_note", "create_note", "edit_page"]);
    expect(changes[0]).toMatchObject({
      tag: "fruit",
      schema: {
        properties: [
          { key: "Qty", type: "number" },
          { key: "Due", type: "date" },
          { key: "Packed", type: "checkbox" },
          { key: "Note", type: "text" },
        ],
        views: [{ name: "Table", type: "table" }],
      },
    });
    expect(changes[3]).toEqual({
      kind: "edit_page",
      path: "library/Stand.md",
      steps: [{ op: "replace", block: { block: "b3", hash: "abc123" }, markdown: "![[tags/fruit.yaml#Table]]\n" }],
    });
    // A table at the most the rows allow still fits: the schema, the notes and the page are at most a hundred changes.
    expect(MAX_ROWS + 2).toBeLessThanOrEqual(BATCH_LIMITS.changes);
  });
});
