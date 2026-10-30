import { describe, expect, it } from "vitest";

import type { NoteMeta, TagSchema, TagView } from "../../lib/vault/types";
import { applyView, readView } from "./model";
import { altMove, moveSort } from "./sort-order";

function note(id: string, props: Record<string, unknown>): NoteMeta {
  return { path: `library/${id}.md`, id, title: id, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["task"], modified: 0, created: null, updated: null, excerpt: "", words: 0, props, locked: false };
}

const schema: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  views: [],
  properties: [
    { key: "status", type: "select", options: ["Todo", "Doing", "Done"] },
    { key: "points", type: "number", options: [] },
  ],
};
const rows = [
  note("a", { status: "Done", points: 1 }),
  note("b", { status: "Todo", points: 5 }),
  note("c", { status: "Todo", points: 2 }),
  note("d", { status: "Done", points: 5 }),
  note("e", { points: 9 }),
  note("f", { status: "Todo", points: 2 }),
];
const ids = (view: Partial<TagView>) => applyView(rows, { name: "V", type: "table", ...view }, schema).map((n) => n.id);

describe("moveSort", () => {
  it("moves a key to a place and leaves the rest in order", () => {
    expect(moveSort(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveSort(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("hands back the same list when nothing can move", () => {
    const list = ["a", "b"];
    expect(moveSort(list, 0, 0)).toBe(list);
    expect(moveSort(list, 0, 2)).toBe(list);
    expect(moveSort(list, -1, 1)).toBe(list);
  });
  it("reads Alt with an arrow as a step", () => {
    expect(altMove("ArrowUp", 2)).toBe(1);
    expect(altMove("ArrowLeft", 2)).toBe(1);
    expect(altMove("ArrowDown", 2)).toBe(3);
    expect(altMove("ArrowRight", 2)).toBe(3);
    expect(altMove("Enter", 2)).toBeNull();
  });
});

describe("several sort keys", () => {
  it("sort by the first, break its ties by the next, and ties of all by title", () => {
    const sort = [
      { key: "status", dir: "asc" as const },
      { key: "points", dir: "desc" as const },
    ];
    // Select options order Todo < Done; no status last; equal points fall back to the title.
    expect(ids({ sort })).toEqual(["b", "c", "f", "d", "a", "e"]);
  });

  it("change with their order", () => {
    const sort = [
      { key: "points", dir: "desc" as const },
      { key: "status", dir: "asc" as const },
    ];
    expect(ids({ sort })).toEqual(["e", "b", "d", "c", "f", "a"]);
  });

  it("are stable: the same input sorts the same way twice", () => {
    const sort = [{ key: "points", dir: "asc" as const }];
    expect(ids({ sort })).toEqual(ids({ sort }));
    expect(ids({ sort })).toEqual(["a", "c", "f", "b", "d", "e"]);
  });
});

describe("filters matched any or all", () => {
  const filter: TagView["filter"] = [
    { key: "status", op: "is", value: "Done" },
    { key: "points", op: "gt", value: 8 },
  ];
  it("keep a note that passes every filter by default", () => {
    expect(ids({ filter })).toEqual([]);
    expect(ids({ filter, filter_mode: "all" })).toEqual([]);
  });
  it("keep a note that passes one when asked", () => {
    expect(ids({ filter, filter_mode: "any" }).sort()).toEqual(["a", "d", "e"]);
  });
  it("show everything for no filters, either way", () => {
    expect(ids({ filter_mode: "any" })).toHaveLength(6);
  });
  it("drop a mode or setting the app cannot use and keep the rest as written", () => {
    const view = readView({ name: "V", type: "table", filter_mode: "some", density: "huge", wrap: "yes", freeze_title: 1, calcs: ["x"], mine: { a: 1 } })!;
    expect(view.filter_mode).toBeUndefined();
    expect(view.density).toBeUndefined();
    expect(view.wrap).toBeUndefined();
    expect(view.freeze_title).toBeUndefined();
    expect(view.calcs).toBeUndefined();
    expect(view.mine).toEqual({ a: 1 });
    const good = readView({ name: "V", type: "table", filter_mode: "any", density: "compact", wrap: true, freeze_title: false, calcs: { points: "sum" } })!;
    expect([good.filter_mode, good.density, good.wrap, good.freeze_title, good.calcs]).toEqual(["any", "compact", true, false, { points: "sum" }]);
  });
});
