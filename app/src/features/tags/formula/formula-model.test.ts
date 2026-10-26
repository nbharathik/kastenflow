import { describe, expect, it } from "vitest";

import type { NoteMeta, TagSchema, TagView } from "../../../lib/vault/types";
import { applyView, passes, readView } from "../model";
import { formulaText, withFormulas } from "./rows";

function note(path: string, props: Record<string, unknown>): NoteMeta {
  return { path, id: path, title: path, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["job"], modified: 0, created: null, updated: null, excerpt: "", words: 0, props, locked: false };
}

const schema: TagSchema = {
  name: "job",
  color: null,
  path: "tags/job.yaml",
  views: [],
  properties: [
    { key: "due", type: "date", options: [] },
    { key: "left", type: "formula", options: [], formula: "days_until(due)" },
  ],
};

const rows = withFormulas(
  [note("a", {}), note("b", {}), note("c", {}), note("d", {})],
  { values: { a: { left: 100 }, b: { left: 9 }, c: { left: -3 }, d: { left: null } }, problems: {} },
);
const order = (view: TagView) => applyView(rows, view, schema).map((n) => n.path);

describe("formula values in a view", () => {
  it("lays the core's values over the properties without changing the notes given", () => {
    const original = [note("a", { due: "2026-10-01" })];
    const filled = withFormulas(original, { values: { a: { left: 4 } }, problems: {} });
    expect(filled[0]!.props).toEqual({ due: "2026-10-01", left: 4 });
    expect(original[0]!.props).toEqual({ due: "2026-10-01" });
    expect(withFormulas(original, null)[0]).toBe(original[0]);
  });

  it("sorts by size, not as text, and keeps empty last either way", () => {
    expect(order({ name: "x", type: "table", sort: [{ key: "left", dir: "asc" }] })).toEqual(["c", "b", "a", "d"]);
    expect(order({ name: "x", type: "table", sort: [{ key: "left", dir: "desc" }] })).toEqual(["a", "b", "c", "d"]);
  });

  it("filters with the plain-word number conditions", () => {
    const by = (op: "gt" | "gte" | "lt" | "lte", value: number) => order({ name: "x", type: "table", filter: [{ key: "left", op, value }] });
    expect(by("gt", 9)).toEqual(["a"]);
    expect(by("gte", 9)).toEqual(["a", "b"]);
    expect(by("lt", 9)).toEqual(["c"]);
    expect(by("lte", 9)).toEqual(["b", "c"]);
  });

  it("never passes an empty value or a non-number through a number condition", () => {
    const def = schema.properties[1];
    expect(passes(note("e", { left: null }), { key: "left", op: "lte", value: 5 }, def)).toBe(false);
    expect(passes(note("e", { left: "soon" }), { key: "left", op: "gte", value: 0 }, def)).toBe(false);
    expect(passes(note("e", { left: 3 }), { key: "left", op: "gt", value: "not a number" }, def)).toBe(false);
  });

  it("keeps the new conditions when a saved view is read", () => {
    expect(readView({ name: "x", type: "table", filter: [{ key: "left", op: "gte", value: 2 }] })?.filter).toEqual([{ key: "left", op: "gte", value: 2 }]);
  });

  it("says a value the way a cell shows it", () => {
    expect(formulaText(1234.5)).toBe((1234.5).toLocaleString(undefined, { maximumFractionDigits: 6 }));
    expect(formulaText(null)).toBe("");
    expect(formulaText("TBD")).toBe("TBD");
    expect(formulaText(-3)).toBe((-3).toLocaleString());
  });
});
