import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../../../lib/vault/types";
import { subDrop } from "./sub-drop";

function note(id: string, parent: string | null = null, extra: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path: `library/${id}.md`,
    id,
    title: id,
    kind: "page",
    icon: null,
    cover: null,
    parent,
    project: null,
    tags: ["task"],
    modified: 0,
    created: null,
    updated: null,
    excerpt: "",
    words: 0,
    props: {},
    locked: false,
    ...extra,
  };
}

const a = note("a");
const a1 = note("a1", "a");
const a1x = note("a1x", "a1");
const b = note("b");
const all = [a, a1, a1x, b];
const path = (n: NoteMeta) => [n.path];

describe("subDrop", () => {
  it("puts a row inside the row it is dropped on the middle of", () => {
    expect(subDrop(all, path(b), a, 0.5, "task")).toEqual({ kind: "into" });
  });

  it("takes a row out to the parent of the row whose edge it is dropped on", () => {
    expect(subDrop(all, path(a1x), b, 0.1, "task")).toEqual({ kind: "out", parent: null, edge: "before" });
    expect(subDrop(all, path(b), a1, 0.9, "task")).toEqual({ kind: "out", parent: a.path, edge: "after" });
    // A row at the top that is dropped at the edge of a nested row joins that row's level.
    expect(subDrop(all, path(a1x), a1, 0.9, "task")).toEqual({ kind: "out", parent: a.path, edge: "after" });
  });

  it("does nothing for a row already inside the row, or already at that level", () => {
    expect(subDrop(all, path(a1), a, 0.5, "task")).toBeNull();
    const a2 = note("a2", "a");
    expect(subDrop([...all, a2], path(a1), a2, 0.1, "task")).toBeNull();
    expect(subDrop(all, path(b), a, 0.1, "task")).toBeNull();
  });

  it("does nothing when the row is dragged over itself", () => {
    expect(subDrop(all, path(a), a, 0.5, "task")).toBeNull();
    expect(subDrop(all, path(a), a, 0.1, "task")).toBeNull();
  });

  it("refuses to put a row inside itself or its own sub-item, in the middle or at an edge", () => {
    const why = "A page cannot go inside itself or its own sub-page.";
    expect(subDrop(all, path(a), a1x, 0.5, "task")).toEqual({ kind: "refuse", why });
    expect(subDrop(all, path(a), a1x, 0.9, "task")).toEqual({ kind: "refuse", why });
    expect(subDrop(all, path(a1), a1x, 0.1, "task")).toEqual({ kind: "refuse", why });
  });

  it("takes only one row that carries the tag, and only pages and cards", () => {
    const other = note("o", null, { tags: ["idea"] });
    const day = note("d", null, { kind: "journal" });
    const set = [...all, other, day];
    expect(subDrop(set, path(other), a, 0.5, "task")).toBeNull();
    expect(subDrop(set, path(day), a, 0.5, "task")).toBeNull();
    expect(subDrop(set, [b.path, a1.path], a, 0.5, "task")).toBeNull();
    expect(subDrop(set, null, a, 0.5, "task")).toBeNull();
    expect(subDrop(set, ["library/missing.md"], a, 0.5, "task")).toBeNull();
  });

  it("cannot put a row inside a row that is not a page", () => {
    const card = note("c", null, { kind: "card" });
    expect(subDrop([...all, card], path(b), card, 0.5, "task")).toBeNull();
  });
});
