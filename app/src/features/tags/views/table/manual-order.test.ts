import { describe, expect, it } from "vitest";

import type { NoteMeta, TagView } from "../../../../lib/vault/types";
import { applyView } from "../../model";
import { canOrder, dropIndex, reorderIds } from "./manual-order";

function note(id: string | null, title = id ?? "none"): NoteMeta {
  return {
    path: `library/${title}.md`, id, title, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["task"],
    modified: 0, created: null, updated: null, excerpt: "", words: 0, props: {}, locked: false,
  };
}
const A = note("a");
const B = note("b");
const C = note("c");
const D = note("d");
const E = note("e");
const POOL = [A, B, C, D, E];
const view = (extra: Partial<TagView> = {}): TagView => ({ name: "All", type: "table", ...extra });

describe("when rows can be put in order by hand", () => {
  const plain = { grouped: false, subItems: false, custom: false };

  it("needs a table with no sort", () => {
    expect(canOrder(view(), plain)).toBe(true);
    expect(canOrder(view({ sort: [] }), plain)).toBe(true);
    expect(canOrder(view({ sort: [{ key: "status", dir: "asc" }] }), plain)).toBe(false);
    expect(canOrder({ name: "B", type: "kanban" }, plain)).toBe(false);
  });

  it("is off for groups, sub-items and a table that is not one tag's", () => {
    expect(canOrder(view(), { ...plain, grouped: true })).toBe(false);
    expect(canOrder(view(), { ...plain, subItems: true })).toBe(false);
    expect(canOrder(view(), { ...plain, custom: true })).toBe(false);
  });
});

describe("moving one row", () => {
  it("puts the row at its new place among the rows shown", () => {
    expect(reorderIds(POOL, POOL, 0, 2)).toEqual(["b", "c", "a", "d", "e"]);
    expect(reorderIds(POOL, POOL, 4, 0)).toEqual(["e", "a", "b", "c", "d"]);
    expect(reorderIds(POOL, POOL, 1, 2)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("does nothing when the row stays where it is or the place is outside", () => {
    expect(reorderIds(POOL, POOL, 2, 2)).toBeNull();
    expect(reorderIds(POOL, POOL, 2, 9)).toBeNull();
    expect(reorderIds(POOL, POOL, -1, 0)).toBeNull();
  });

  it("keeps the rows a filter hides where they were", () => {
    // Only a, c and e are shown; c goes above a. b and d keep their places.
    const shown = [A, C, E];
    expect(reorderIds(POOL, shown, 1, 0)).toEqual(["c", "b", "a", "d", "e"]);
    expect(reorderIds(POOL, shown, 0, 2)).toEqual(["c", "b", "e", "d", "a"]);
  });

  it("puts a shown row the pool does not hold at the end", () => {
    const stray = note("z");
    expect(reorderIds(POOL, [A, stray], 1, 0)).toEqual(["z", "b", "c", "d", "e", "a"]);
  });

  it("cannot order a row that has no id yet", () => {
    const loose = note(null);
    expect(reorderIds([A, loose, B], [A, loose, B], 0, 2)).toBeNull();
  });

  it("leaves rows without an id out of the list", () => {
    const loose = note(null);
    expect(reorderIds([A, loose, B], [A, B], 0, 1)).toEqual(["b", "a"]);
  });

  it("refuses a list longer than the core takes", () => {
    const many = Array.from({ length: 5001 }, (_, i) => note(`n${i}`));
    expect(reorderIds(many, many, 0, 1)).toBeNull();
  });
});

describe("where a drop lands", () => {
  it("is the target's place, before or after it, as the row will be once it has left", () => {
    expect(dropIndex(0, 3, false)).toBe(2);
    expect(dropIndex(0, 3, true)).toBe(3);
    expect(dropIndex(4, 1, false)).toBe(1);
    expect(dropIndex(4, 1, true)).toBe(2);
    expect(dropIndex(2, 2, true)).toBe(2);
  });
});

describe("the order a view keeps, as the table reads it", () => {
  const rows = [note("a", "Alpha"), note("b", "Bravo"), note("c", "Charlie"), note("d", "Delta"), note(null, "Echo")];
  const titles = (v: TagView) => applyView(rows, v, null).map((n) => n.title);

  it("is by title until someone puts rows in order", () => {
    expect(titles(view())).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  });

  it("follows the ids kept in the view, new rows and rows without ids at the end", () => {
    expect(titles(view({ order: ["c", "a"] }))).toEqual(["Charlie", "Alpha", "Bravo", "Delta", "Echo"]);
  });

  it("ignores ids no row has", () => {
    expect(titles(view({ order: ["zzz", "d", "b"] }))).toEqual(["Delta", "Bravo", "Alpha", "Charlie", "Echo"]);
  });

  it("is ignored while the view has a sort", () => {
    expect(titles(view({ order: ["d"], sort: [{ key: "title", dir: "desc" }] }))).toEqual(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
  });

  it("is ignored when it is not a list", () => {
    expect(titles(view({ order: "c" as unknown as string[] }))).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  });

  it("repeated ids count once, at their first place", () => {
    expect(titles(view({ order: ["c", "a", "c"] }))).toEqual(["Charlie", "Alpha", "Bravo", "Delta", "Echo"]);
  });
});
