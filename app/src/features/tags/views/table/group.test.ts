import { describe, expect, it } from "vitest";

import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { groupChoices, groupId, groupLabel, groupSpec, inheritedIds, membersOf, orderGroups, partition, type GroupSpec } from "./group";

function note(id: string, props: Record<string, unknown>, extra: Partial<NoteMeta> = {}): NoteMeta {
  return { path: `library/${id}.md`, id, title: id, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["task"], modified: 0, created: null, updated: null, excerpt: "", words: 0, props, locked: false, ...extra };
}

const schema: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  views: [],
  properties: [
    { key: "status", type: "select", options: ["Todo", "Doing", "Done"] },
    { key: "labels", type: "multi_select", options: ["ui", "core"] },
    { key: "urgent", type: "checkbox", options: [] },
    { key: "due", type: "date", options: [] },
    { key: "blocks", type: "relation", options: [] },
    { key: "points", type: "number", options: [] },
  ],
};
const view = (group_by: string, more: Partial<TagView> = {}): TagView => ({ name: "V", type: "table", group_by, ...more });
const spec = (key: string): GroupSpec => groupSpec(view(key), schema)!;

describe("groupSpec", () => {
  it("takes the groupable properties, and nothing else", () => {
    expect(spec("status")).toMatchObject({ kind: "select", options: ["Todo", "Doing", "Done"] });
    for (const [key, kind] of [["labels", "multi_select"], ["urgent", "checkbox"], ["due", "date"], ["blocks", "relation"], ["created", "date"]] as const) expect(spec(key).kind).toBe(kind);
    expect(groupSpec(view("points"), schema)).toBeNull();
    expect(groupSpec(view("gone"), schema)).toBeNull();
    expect(groupSpec({ name: "V", type: "table" }, schema)).toBeNull();
    expect(groupSpec({ name: "V", type: "kanban", group_by: "status" }, schema)).toBeNull();
  });

  it("offers project only in a view that spans projects", () => {
    expect(groupSpec(view("project"), schema)).toBeNull();
    expect(groupSpec(view("project", { scope: "project" }), schema)?.kind).toBe("project");
    expect(groupChoices(view("x"), schema).map((c) => c.key)).toEqual(["status", "labels", "urgent", "due", "blocks", "created", "updated"]);
    expect(groupChoices(view("x", { scope: "vault" }), schema).map((c) => c.key)).toContain("project");
  });
});

describe("groupId", () => {
  it("reads each kind of value", () => {
    expect(groupId(note("a", { status: "done" }), spec("status"))).toBe("Done");
    expect(groupId(note("a", { status: "Blocked" }), spec("status"))).toBe("Blocked");
    expect(groupId(note("a", { status: "  " }), spec("status"))).toBeNull();
    expect(groupId(note("a", {}), spec("status"))).toBeNull();
    expect(groupId(note("a", { labels: ["core", "ui"] }), spec("labels"))).toBe("core");
    expect(groupId(note("a", { labels: [] }), spec("labels"))).toBeNull();
    expect(groupId(note("a", { urgent: true }), spec("urgent"))).toBe("true");
    expect(groupId(note("a", { urgent: "true" }), spec("urgent"))).toBe("true");
    expect(groupId(note("a", {}), spec("urgent"))).toBe("false");
    expect(groupId(note("a", { due: "2026-03-15" }), spec("due"))).toBe("2026-03");
    expect(groupId(note("a", { due: "soon" }), spec("due"))).toBeNull();
    expect(groupId(note("a", {}, { created: "2026-04-01T10:00:00Z" }), spec("created"))).toBe("2026-04");
    expect(groupId(note("a", { blocks: ["n-1", "n-2"] }), spec("blocks"))).toBe("n-1");
  });
});

describe("groupLabel", () => {
  it("names groups, months and the empty one", () => {
    expect(groupLabel(spec("status"), null)).toBe("No value");
    expect(groupLabel(spec("urgent"), "true")).toBe("Checked");
    expect(groupLabel(spec("urgent"), "false")).toBe("Not checked");
    expect(groupLabel(spec("due"), "2026-03")).toMatch(/2026/);
    expect(groupLabel(spec("blocks"), "n-1", (id) => `Title of ${id}`)).toBe("Title of n-1");
    expect(groupLabel(spec("blocks"), "n-1")).toBe("n-1");
  });
});

describe("orderGroups", () => {
  it("puts options in their order, then other values by name, then no value", () => {
    expect(orderGroups(spec("status"), [null, "Zed", "Done", "Alpha", "Todo"])).toEqual(["Todo", "Done", "Alpha", "Zed", null]);
  });
  it("orders checked first, months by time, relations by title", () => {
    expect(orderGroups(spec("urgent"), ["false", "true"])).toEqual(["true", "false"]);
    expect(orderGroups(spec("due"), ["2026-11", null, "2026-02", "2025-12"])).toEqual(["2025-12", "2026-02", "2026-11", null]);
    const titles: Record<string, string> = { a: "Zebra", b: "Apple" };
    expect(orderGroups(spec("blocks"), ["a", "b", null], (id) => titles[id]!)).toEqual(["b", "a", null]);
  });
});

describe("partition", () => {
  it("keeps each group's rows in the order given", () => {
    const items = [note("1", { status: "Done" }), note("2", {}), note("3", { status: "Todo" }), note("4", { status: "Done" })];
    const groups = partition(items, items.map((n) => groupId(n, spec("status"))), spec("status"));
    expect(groups.map((g) => [g.label, g.items.map((n) => n.id)])).toEqual([["Todo", ["3"]], ["Done", ["1", "4"]], ["No value", ["2"]]]);
  });

  it("has no groups for no rows", () => {
    expect(partition([], [], spec("status"))).toEqual([]);
  });
});

describe("with sub-items", () => {
  const parent = note("p", { status: "Done" });
  const kid = note("k", { status: "Todo" }, { parent: "p" });
  const grand = note("g", {}, { parent: "k" });
  const other = note("o", { status: "Todo" });
  const tree = [parent, kid, grand, other];

  it("keeps a sub-item in its top-level row's group", () => {
    const rows = [
      { note: parent, depth: 0 },
      { note: kid, depth: 1 },
      { note: grand, depth: 2 },
      { note: other, depth: 0 },
    ];
    const ids = inheritedIds(rows, spec("status"));
    expect(ids).toEqual(["Done", "Done", "Done", "Todo"]);
    const groups = partition(rows, ids, spec("status"));
    expect(groups.map((g) => g.items.map((r) => r.note.id))).toEqual([["o"], ["p", "k", "g"]]);
  });

  it("counts a sub-item, folded or not, in its top-level row's group", () => {
    const members = membersOf(tree, tree, spec("status"), true);
    expect(members.get("Done")?.map((n) => n.id)).toEqual(["p", "k", "g"]);
    expect(members.get("Todo")?.map((n) => n.id)).toEqual(["o"]);
    const flat = membersOf(tree, tree, spec("status"), false);
    expect(flat.get("Todo")?.map((n) => n.id)).toEqual(["k", "o"]);
    expect(flat.get(null)?.map((n) => n.id)).toEqual(["g"]);
  });

  it("copes with a ring of parents", () => {
    const x = note("x", { status: "Todo" }, { parent: "y" });
    const y = note("y", { status: "Done" }, { parent: "x" });
    const members = membersOf([x, y], [x, y], spec("status"), true);
    expect([...members.values()].flat()).toHaveLength(2);
  });
});
