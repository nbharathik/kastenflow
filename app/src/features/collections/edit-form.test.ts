import { describe, expect, it } from "vitest";

import type { Collection } from "../../lib/vault/collection-types";
import { editsOf, filtersOf, formOf, hasEdits } from "./edit-form";

const collection = (patch: Partial<Collection> = {}): Collection => ({
  path: "views/q.yaml",
  slug: "q",
  name: "Queue",
  icon: "book",
  query: "#capture",
  when: { updated: "last-30-days" },
  filter: [{ key: "reading", op: "is", value: "Unread" }],
  sort: [{ key: "captured", dir: "desc" }],
  display: { type: "table", columns: ["title", "site"], limit: 500 },
  format: 1,
  hash: "h",
  modified: 0,
  problem: null,
  readOnly: false,
  ...patch,
});

describe("the edit form", () => {
  it("sends nothing when nothing changed", () => {
    for (const c of [collection(), collection({ icon: null, when: null, filter: [], sort: [], display: null, query: "" })]) {
      expect(editsOf(c, formOf(c))).toEqual({});
    }
    expect(hasEdits({})).toBe(false);
  });

  it("sends only the keys that differ", () => {
    const c = collection();
    const form = { ...formOf(c), query: "tag:paper", icon: "" };
    expect(editsOf(c, form)).toEqual({ query: "tag:paper", icon: null });
    expect(hasEdits(editsOf(c, form))).toBe(true);
  });

  it("changes the days, and removes them with none", () => {
    const c = collection();
    expect(editsOf(c, { ...formOf(c), whenField: "created", whenToken: "this-year" })).toEqual({ when: { created: "this-year" } });
    expect(editsOf(c, { ...formOf(c), whenField: "" })).toEqual({ when: null });
    const none = collection({ when: null });
    expect(editsOf(none, { ...formOf(none), whenField: "on", whenToken: "today" })).toEqual({ when: { on: "today" } });
  });

  it("makes filters and sorts from rows, dropping empty ones and the value an op does not take", () => {
    const c = collection();
    const form = {
      ...formOf(c),
      filters: [
        { key: "reading", op: "is_not" as const, value: "Finished" },
        { key: " due ", op: "empty" as const, value: "left over" },
        { key: "", op: "is" as const, value: "x" },
      ],
      sorts: [{ key: "updated", dir: "asc" as const }, { key: " ", dir: "desc" as const }],
    };
    expect(editsOf(c, form)).toEqual({
      filter: [{ key: "reading", op: "is_not", value: "Finished" }, { key: "due", op: "empty" }],
      sort: [{ key: "updated", dir: "asc" }],
    });
    expect(editsOf(c, { ...formOf(c), filters: [], sorts: [] })).toEqual({ filter: null, sort: null });
    expect(filtersOf([{ key: "n", op: "is", value: "" }])).toEqual([{ key: "n", op: "is", value: "" }]);
  });

  it("keeps the display's other keys when the kind or the limit changes", () => {
    const c = collection();
    expect(editsOf(c, { ...formOf(c), kind: "gallery" })).toEqual({ display: { type: "gallery", columns: ["title", "site"], limit: 500 } });
    expect(editsOf(c, { ...formOf(c), limit: "" })).toEqual({ display: { type: "table", columns: ["title", "site"] } });
    expect(editsOf(c, { ...formOf(c), limit: "99999" })).toEqual({ display: { type: "table", columns: ["title", "site"], limit: 5000 } });
    expect(editsOf(c, { ...formOf(c), limit: "0" })).toEqual({ display: { type: "table", columns: ["title", "site"], limit: 1 } });
  });

  it("does not write a display for a collection that said nothing and still says nothing", () => {
    const c = collection({ display: null });
    expect(editsOf(c, formOf(c))).toEqual({});
    expect(editsOf(c, { ...formOf(c), kind: "list" })).toEqual({ display: { type: "list" } });
  });
});
