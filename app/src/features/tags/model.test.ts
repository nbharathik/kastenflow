import { describe, expect, it } from "vitest";

import type { TagSchema, TagView } from "../../lib/vault/types";
import { metaFor } from "../workspace/preview/note-meta";
import { BUILT_IN, applyView, columnsOf, freshName, groupDef, keyLabel, newView, notesWith, passes, readView, scoped, valueOf, vaultTags, viewsOf } from "./model";

const note = (path: string, title: string, tags: string[], props: Record<string, string | number | boolean | string[]> = {}) => {
  const lines = Object.entries(props).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`);
  const text = `---\ntitle: ${title}\ntags: [${tags.join(", ")}]\n${lines.length ? `props:\n${lines.join("\n")}\n` : ""}---\nBody\n`;
  return metaFor(path, text, 0);
};

const TASK: TagSchema = {
  name: "task",
  color: "green",
  path: "tags/task.yaml",
  properties: [
    { key: "status", type: "select", options: ["Todo", "Doing", "Done"] },
    { key: "due", type: "date", options: [] },
    { key: "points", type: "number", options: [] },
    { key: "urgent", type: "checkbox", options: [] },
  ],
  views: [{ name: "Board", type: "kanban", group_by: "status" }, { name: "Odd", type: "roadmap" }, { type: "table" }],
};

const notes = [
  note("a.md", "Write intro", ["task"], { status: "Doing", due: "2026-10-02", points: 3 }),
  note("b.md", "Book flights", ["Task", "travel"], { status: "Todo", due: "2026-09-30", points: 10, urgent: true }),
  note("c.md", "Plan budget", ["task"], { status: "Done", points: 1 }),
  note("d.md", "Loose end", ["task"], { status: "Blocked" }),
  note("e.md", "No status yet", ["task"], {}),
  note("f.md", "Other", ["idea"], {}),
];

describe("tag database model", () => {
  it("lists a tag's notes whatever the case, and every tag with its count", () => {
    expect(notesWith(notes, "TASK").map((n) => n.path)).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
    const tags = vaultTags(
      [
        { tag: "task", count: 4 },
        { tag: "Task", count: 1 },
        { tag: "idea", count: 1 },
      ],
      [TASK, { ...TASK, name: "meeting", path: "tags/meeting.yaml" }],
    );
    expect(tags.map((t) => [t.tag, t.count, t.schema?.name ?? null])).toEqual([
      ["task", 5, "task"],
      ["idea", 1, null],
      ["meeting", 0, "meeting"],
    ]);
  });

  it("shows the views it can, else one table, and names new ones", () => {
    expect(viewsOf(TASK)).toEqual([{ name: "Board", type: "kanban", group_by: "status" }]);
    expect(viewsOf(null)).toEqual([{ name: "All", type: "table" }]);
    expect(freshName(viewsOf(TASK), "Board")).toBe("Board 2");
    expect(newView("kanban", TASK, [])).toEqual({ name: "Board", type: "kanban", group_by: "status" });
    expect(newView("calendar", TASK, [])).toEqual({ name: "Calendar", type: "calendar", date: "due" });
    expect(newView("list", null, [])).toEqual({ name: "List", type: "list" });
  });

  it("reads a view written by hand, leaving out settings in a shape it cannot use", () => {
    const views = viewsOf({
      ...TASK,
      views: [
        null,
        "table",
        { name: " Loose ", type: "table", filter: "oops", sort: { key: "due" }, columns: ["due", 2026, null], group_by: 5, date: ["due"], extra: 1 },
        { name: "Soon", type: "list", filter: [{ key: "status", op: "is", value: "Todo" }, { key: "x", op: "near" }, null], sort: [{ key: "due" }, { dir: "desc" }] },
      ],
    } as unknown as TagSchema);
    expect(views).toEqual([
      { name: "Loose", type: "table", filter: [], sort: [], columns: ["due", "2026"], group_by: "5", extra: 1 },
      { name: "Soon", type: "list", filter: [{ key: "status", op: "is", value: "Todo" }], sort: [{ key: "due", dir: "asc" }] },
    ]);
    // Every view reads without throwing.
    for (const view of views) expect(() => applyView(notes, view, TASK)).not.toThrow();
  });

  it("never takes a name such as constructor for a property", () => {
    expect(passes(notes[4]!, { key: "constructor", op: "empty" }, undefined)).toBe(true);
    expect(passes(notes[4]!, { key: "toString", op: "not_empty" }, undefined)).toBe(false);
  });

  it("filters by the day a note was edited", () => {
    const edited = { ...notes[0]!, modified: new Date(2026, 8, 20, 23, 30).getTime() };
    expect(passes(edited, { key: "modified", op: "before", value: "2026-09-21" }, undefined)).toBe(true);
    expect(passes(edited, { key: "modified", op: "after", value: "2026-09-19" }, undefined)).toBe(true);
    expect(passes(edited, { key: "modified", op: "after", value: "2026-09-20" }, undefined)).toBe(false);
  });

  it("filters by value, emptiness and dates", () => {
    const def = (key: string) => TASK.properties.find((p) => p.key === key);
    const b = notes[1]!;
    expect(passes(b, { key: "status", op: "is", value: "todo" }, def("status"))).toBe(true);
    expect(passes(b, { key: "status", op: "is_not", value: "Todo" }, def("status"))).toBe(false);
    expect(passes(b, { key: "title", op: "contains", value: "FLIGHT" }, undefined)).toBe(true);
    expect(passes(b, { key: "due", op: "before", value: "2026-10-01" }, def("due"))).toBe(true);
    expect(passes(b, { key: "due", op: "after", value: "2026-10-01" }, def("due"))).toBe(false);
    expect(passes(notes[2]!, { key: "due", op: "empty" }, def("due"))).toBe(true);
    expect(passes(notes[0]!, { key: "urgent", op: "empty" }, def("urgent"))).toBe(true);
    expect(passes(b, { key: "urgent", op: "is", value: true }, def("urgent"))).toBe(true);
  });

  it("sorts by type with empty values last, and title breaking ties", () => {
    const tasks = notesWith(notes, "task");
    const order = (sort: { key: string; dir: "asc" | "desc" }[]) => applyView(tasks, { name: "x", type: "table", sort }, TASK).map((n) => n.path);
    expect(order([{ key: "status", dir: "asc" }])).toEqual(["b.md", "a.md", "c.md", "d.md", "e.md"]);
    expect(order([{ key: "points", dir: "desc" }])).toEqual(["b.md", "a.md", "c.md", "d.md", "e.md"]);
    // No due date: last, by title.
    expect(order([{ key: "due", dir: "asc" }])).toEqual(["b.md", "a.md", "d.md", "e.md", "c.md"]);
    expect(order([])).toEqual(["b.md", "d.md", "e.md", "c.md", "a.md"]);
    const filtered = applyView(tasks, { name: "x", type: "list", filter: [{ key: "status", op: "is_not", value: "Done" }] }, TASK);
    expect(filtered.map((n) => n.path)).not.toContain("c.md");
  });

  it("puts a board's notes in the columns of its select, odd values after", () => {
    const def = groupDef({ name: "Board", type: "kanban", group_by: "nope" }, TASK)!;
    expect(def.key).toBe("status");
    const columns = columnsOf(notesWith(notes, "task"), def);
    expect(columns.map((c) => [c.label, c.notes.map((n) => n.path)])).toEqual([
      ["No status", ["e.md"]],
      ["Todo", ["b.md"]],
      ["Doing", ["a.md"]],
      ["Done", ["c.md"]],
      ["Blocked", ["d.md"]],
    ]);
    expect(groupDef({ name: "B", type: "kanban" }, { ...TASK, properties: [] })).toBeNull();
  });

  it("puts a number written for an option in that option's column", () => {
    const priority = { key: "priority", type: "select", options: ["1", "2", "3"] };
    const ranked = [note("p.md", "Ranked", ["task"], { priority: 2 }), note("q.md", "Listed", ["task"], { priority: ["3"] })];
    expect(columnsOf(ranked, priority).map((c) => [c.label, c.notes.map((n) => n.path)])).toEqual([
      ["1", []],
      ["2", ["p.md"]],
      ["3", ["q.md"]],
    ]);
  });
});

describe("keys for views that span tags and projects", () => {
  const spanning = (extra: Partial<TagView> = {}): TagView => ({ name: "T", type: "table", scope: "project", ...extra });
  const there = metaFor("projects/trip/pages/plan.md", "---\ntitle: Plan\ntags: [Paper, idea]\n---\nBody\n", 0);
  const elsewhere = metaFor("library/x.md", "---\ntitle: X\n---\nBody\n", 0);
  const card = metaFor("projects/trip/cards/c.md", "---\ntitle: C\ntype: card\n---\nBody\n", 0);
  const own = metaFor("projects/trip/_project.md", "---\ntitle: Trip\ntype: project\n---\nBody\n", 0);

  it("read a note's project, type and tags", () => {
    expect(valueOf(there, "project")).toBe("trip");
    expect(valueOf(there, "type")).toBe("page");
    expect(valueOf(there, "tags")).toEqual(["Paper", "idea"]);
    expect(valueOf(elsewhere, "project")).toBeNull();
    // A property of the same name still wins, as it always did.
    const prop = metaFor("library/y.md", "---\ntitle: Y\nprops:\n  project: mine\n---\nBody\n", 0);
    expect(valueOf(prop, "project")).toBe("mine");
  });

  it("filter and sort on them", () => {
    expect(passes(there, { key: "tags", op: "contains", value: "PAP" }, undefined)).toBe(true);
    expect(passes(there, { key: "tags", op: "is", value: "idea" }, undefined)).toBe(true);
    expect(passes(there, { key: "type", op: "is", value: "card" }, undefined)).toBe(false);
    expect(passes(card, { key: "type", op: "is", value: "card" }, undefined)).toBe(true);
    expect(passes(elsewhere, { key: "project", op: "empty" }, undefined)).toBe(true);
    const order = (key: string, dir: "asc" | "desc") => applyView([there, elsewhere, card], spanning({ sort: [{ key, dir }] }), null).map((n) => n.path);
    expect(order("type", "asc")).toEqual(["projects/trip/cards/c.md", "projects/trip/pages/plan.md", "library/x.md"]);
    // A note with no project goes last whichever way.
    expect(order("project", "asc")[2]).toBe("library/x.md");
    expect(order("project", "desc")[2]).toBe("library/x.md");
  });

  it("are named in chips and headers only where the view spans", () => {
    expect(keyLabel(spanning(), "project")).toBe("Project");
    expect(keyLabel(spanning(), "tags")).toBe("Tags");
    expect(keyLabel(spanning(), "updated")).toBe("Updated");
    expect(keyLabel(spanning(), "venue")).toBe("venue");
    // A tag's own view keeps naming a property `project` as it is written.
    expect(keyLabel({ name: "All", type: "table" }, "project")).toBe("project");
    expect(keyLabel({ name: "All", type: "table" }, "title")).toBe("Title");
    expect(Object.keys(BUILT_IN)).toEqual(["title", "created", "updated", "modified"]);
  });

  it("read a scope, and leave one that is not a scope out", () => {
    expect(readView({ name: "A", type: "table", scope: "project" })!.scope).toBe("project");
    expect(readView({ name: "A", type: "table", scope: "vault" })!.scope).toBe("vault");
    expect("scope" in readView({ name: "A", type: "table", scope: "everywhere" })!).toBe(false);
    expect("scope" in readView({ name: "A", type: "table" })!).toBe(false);
  });

  it("read the sub-items switches as true or false, and leave out anything else", () => {
    expect(readView({ name: "A", type: "table", sub_items: true })!.sub_items).toBe(true);
    expect(readView({ name: "A", type: "list", hide_sub_items: true })!.hide_sub_items).toBe(true);
    expect(readView({ name: "A", type: "table", sub_items: false })!.sub_items).toBe(false);
    expect("sub_items" in readView({ name: "A", type: "table", sub_items: "yes" })!).toBe(false);
    expect("hide_sub_items" in readView({ name: "A", type: "list", hide_sub_items: 1 })!).toBe(false);
    expect("sub_items" in readView({ name: "A", type: "table" })!).toBe(false);
  });

  it("cover the notes of the project (not its own page), or every note", () => {
    const all = [there, elsewhere, card, own, metaFor("templates/t.md", "---\ntitle: T\n---\n", 0)];
    expect(scoped(all, spanning(), "trip").map((n) => n.path)).toEqual(["projects/trip/pages/plan.md", "projects/trip/cards/c.md"]);
    expect(scoped(all, spanning(), null)).toEqual([]);
    expect(scoped(all, spanning({ scope: "vault" }), "trip")).toHaveLength(4);
    // A tag's own view covers what it is given.
    expect(scoped(all, { name: "All", type: "table" }, "trip")).toHaveLength(5);
  });
});
