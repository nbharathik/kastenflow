import { describe, expect, it } from "vitest";

import type { TagSchema, TagView } from "../../../../lib/vault/types";
import {
  clampWidth,
  gridTemplate,
  hiddenColumns,
  hideColumn,
  moveColumn,
  showColumn,
  sortColumn,
  sortOf,
  tableColumns,
  widthOf,
  withWidth,
} from "./columns";

const PAPER: TagSchema = {
  name: "paper",
  color: "blue",
  path: "tags/paper.yaml",
  properties: [
    { key: "status", type: "select", options: ["Idea", "Drafting", "Submitted"] },
    { key: "venue", type: "text", options: [] },
    { key: "deadline", type: "date", options: [] },
    { key: "coauthors", type: "multi_select", options: [] },
    { key: "repo", type: "url", options: [] },
  ],
  views: [],
};

const table = (extra: Partial<TagView> = {}): TagView => ({ name: "All", type: "table", ...extra });
const keys = (view: TagView, schema: TagSchema | null = PAPER) => tableColumns(view, schema).map((c) => c.key);

describe("table columns", () => {
  it("shows the title, then every property in the schema's order", () => {
    const columns = tableColumns(table(), PAPER);
    expect(columns.map((c) => [c.key, c.kind, c.type, c.label])).toEqual([
      ["title", "title", "title", "Title"],
      ["status", "prop", "select", "status"],
      ["venue", "prop", "text", "venue"],
      ["deadline", "prop", "date", "deadline"],
      ["coauthors", "prop", "multi_select", "coauthors"],
      ["repo", "prop", "url", "repo"],
    ]);
    expect(columns[1]!.def?.options).toEqual(["Idea", "Drafting", "Submitted"]);
    expect(keys(table(), null)).toEqual(["title"]);
  });

  it("shows the view's columns in order, skipping unknown keys, repeats and the title", () => {
    expect(keys(table({ columns: ["deadline", "nope", "status", "deadline", "title"] }))).toEqual(["title", "deadline", "status"]);
    // Built-in fields can be shown; they are read-only.
    const columns = tableColumns(table({ columns: ["status", "updated", "modified"] }), PAPER);
    expect(columns.map((c) => [c.key, c.kind, c.label])).toEqual([
      ["title", "title", "Title"],
      ["status", "prop", "status"],
      ["updated", "builtin", "Updated"],
      ["modified", "builtin", "Edited"],
    ]);
    // A property the schema defines wins over a built-in of the same name.
    const own = { ...PAPER, properties: [...PAPER.properties, { key: "created", type: "date", options: [] }] };
    expect(tableColumns(table({ columns: ["created"] }), own)[1]!.kind).toBe("prop");
    // An empty list shows the title alone.
    expect(keys(table({ columns: [] }))).toEqual(["title"]);
  });

  it("never shows a property called title beside the title, nor odd names as lookups", () => {
    const odd = { ...PAPER, properties: [{ key: "title", type: "text", options: [] }, { key: "constructor", type: "constructor", options: [] }] };
    const columns = tableColumns(table(), odd);
    expect(columns.map((c) => c.key)).toEqual(["title", "constructor"]);
    expect(hiddenColumns(table(), odd).map((c) => c.key)).toEqual(["created", "updated", "modified"]);
    expect(showColumn(table({ columns: [] }), odd, "title").columns).toEqual([]);
    // A type named like an object's own method still gets a plain width.
    expect(widthOf(table(), columns[1]!)).toBe(widthOf(table(), { ...columns[1]!, type: "text" }));
  });

  it("lists what is hidden: properties first, then the built-in fields", () => {
    const hidden = hiddenColumns(table({ columns: ["repo", "status", "created"] }), PAPER);
    expect(hidden.map((c) => c.key)).toEqual(["venue", "deadline", "coauthors", "updated", "modified"]);
    expect(hiddenColumns(table(), PAPER).map((c) => c.key)).toEqual(["created", "updated", "modified"]);
  });

  it("offers project, type and tags only to a view that spans tags and projects (it has a scope)", () => {
    // A tag's own table: unchanged, and a column called project is not one.
    expect(keys(table({ columns: ["project", "type", "tags", "status"] }))).toEqual(["title", "status"]);
    expect(hiddenColumns(table({ columns: [] }), PAPER).map((c) => c.key)).toEqual(["status", "venue", "deadline", "coauthors", "repo", "created", "updated", "modified"]);
    // A project's saved table: no schema, and the extra fields are columns.
    const saved = table({ scope: "project", columns: ["type", "tags", "project", "updated"] });
    expect(tableColumns(saved, null).map((c) => [c.key, c.kind, c.label])).toEqual([
      ["title", "title", "Title"],
      ["type", "builtin", "Type"],
      ["tags", "builtin", "Tags"],
      ["project", "builtin", "Project"],
      ["updated", "builtin", "Updated"],
    ]);
    expect(hiddenColumns(saved, null).map((c) => c.key)).toEqual(["created", "modified"]);
    expect(hiddenColumns(table({ scope: "vault", columns: [] }), null).map((c) => c.key)).toEqual(["created", "updated", "modified", "project", "type", "tags"]);
    expect(showColumn(table({ scope: "project", columns: ["type"] }), null, "tags").columns).toEqual(["type", "tags"]);
    // Their widths come from their own entries.
    expect(widthOf(saved, tableColumns(saved, null)[2]!)).toBe(220);
  });

  it("hides, shows and moves columns by writing the view's columns, keeping its other keys", () => {
    const view = table({ sort: [{ key: "deadline", dir: "asc" }], "x-extra": 1 });
    const hidden = hideColumn(view, PAPER, "venue");
    expect(hidden.columns).toEqual(["status", "deadline", "coauthors", "repo"]);
    expect(hidden.sort).toEqual(view.sort);
    expect(hidden["x-extra"]).toBe(1);
    expect(showColumn(hidden, PAPER, "venue").columns).toEqual(["status", "deadline", "coauthors", "repo", "venue"]);
    expect(showColumn(hidden, PAPER, "status")).toBe(hidden);
    expect(moveColumn(view, PAPER, "venue", -1).columns).toEqual(["venue", "status", "deadline", "coauthors", "repo"]);
    expect(moveColumn(view, PAPER, "venue", 1).columns).toEqual(["status", "deadline", "venue", "coauthors", "repo"]);
    // Past either end, or the title: nothing to do.
    expect(moveColumn(view, PAPER, "status", -1)).toBe(view);
    expect(moveColumn(view, PAPER, "repo", 1)).toBe(view);
    expect(hideColumn(view, PAPER, "title")).toBe(view);
    // Unknown keys the view lists are dropped once the columns are written.
    expect(hideColumn(table({ columns: ["gone", "status", "venue"] }), PAPER, "venue").columns).toEqual(["status"]);
  });

  it("sorts by one column, replacing the view's sorts", () => {
    const view = table({ sort: [{ key: "status", dir: "asc" }, { key: "deadline", dir: "desc" }] });
    expect(sortOf(view, "status")).toBe("asc");
    expect(sortOf(view, "deadline")).toBeNull();
    expect(sortColumn(view, "venue", "desc").sort).toEqual([{ key: "venue", dir: "desc" }]);
    expect(sortColumn(view, "status", "asc").sort).toEqual([{ key: "status", dir: "asc" }]);
    const once = table({ sort: [{ key: "status", dir: "asc" }] });
    expect(sortColumn(once, "status", "asc")).toBe(once);
  });

  it("reads widths from the view, clamped, else a default for the type", () => {
    const [title, status, venue, deadline] = tableColumns(table(), PAPER);
    const view = table({ widths: { title: 320, status: 12, venue: "wide", deadline: 5000 } });
    expect(widthOf(view, title!)).toBe(320);
    expect(widthOf(view, status!)).toBe(clampWidth(status!, 12));
    expect(widthOf(view, venue!)).toBe(widthOf(table(), venue!));
    expect(widthOf(view, deadline!)).toBe(clampWidth(deadline!, 5000));
    expect(clampWidth(status!, 12)).toBeGreaterThanOrEqual(60);
    expect(clampWidth(title!, 40)).toBeGreaterThanOrEqual(120);
    expect(clampWidth(deadline!, 5000)).toBeLessThanOrEqual(900);
    expect(widthOf(table(), title!)).toBeGreaterThan(widthOf(table(), status!));
  });

  it("writes one width, rounded and clamped, keeping the others", () => {
    const view = table({ widths: { title: 300, other: "kept" } });
    const [, status] = tableColumns(view, PAPER);
    expect(withWidth(view, status!, 181.6).widths).toEqual({ title: 300, other: "kept", status: 182 });
    expect((withWidth(table(), status!, 3).widths as Record<string, number>).status).toBe(clampWidth(status!, 3));
    expect(withWidth(view, tableColumns(view, PAPER)[0]!, 300)).toBe(view);
  });

  it("lays the columns out as one grid template, with a filler at the end", () => {
    expect(gridTemplate([280, 150, 96])).toBe("280px 150px 96px minmax(44px, 1fr)");
  });
});
