import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { arranged, movedIds } from "./tree-order";
import { build } from "./tree-index";

function note(id: string, title: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path: `library/${id}.md`,
    id,
    title,
    kind: "page",
    icon: null,
    cover: null,
    parent: null,
    project: null,
    tags: [],
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

const kids = () => [note("a", "Apple"), note("b", "banana"), note("c", "Cherry")];
const titles = (list: NoteMeta[]) => list.map((n) => n.title);

describe("arranged", () => {
  it("keeps the alphabetical list with no stored order", () => {
    expect(titles(arranged(undefined, kids()))).toEqual(["Apple", "banana", "Cherry"]);
    expect(titles(arranged([], kids()))).toEqual(["Apple", "banana", "Cherry"]);
  });

  it("puts the named sub-pages first, in the stored order", () => {
    expect(titles(arranged(["c", "a"], kids()))).toEqual(["Cherry", "Apple", "banana"]);
  });

  it("ignores unknown and repeated ids and puts missing sub-pages after, alphabetically", () => {
    expect(titles(arranged(["zz", "c", "c", "gone"], kids()))).toEqual(["Cherry", "Apple", "banana"]);
  });

  it("returns the very same list when nothing moves", () => {
    const list = kids();
    expect(arranged(["a", "b", "c"], list)).toBe(list);
    expect(arranged(undefined, list)).toBe(list);
  });
});

describe("movedIds", () => {
  it("moves one sub-page before or after another, and storing every id", () => {
    expect(movedIds(kids(), "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(movedIds(kids(), "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(movedIds(kids(), "a", "b", true)).toEqual(["b", "a", "c"]);
  });

  it("is null when the order would stay as it is or a name is not there", () => {
    expect(movedIds(kids(), "a", "b", false)).toBeNull();
    expect(movedIds(kids(), "b", "a", true)).toBeNull();
    expect(movedIds(kids(), "a", "a", true)).toBeNull();
    expect(movedIds(kids(), "x", "a", true)).toBeNull();
  });
});

describe("the sidebar index", () => {
  it("lists a page's sub-pages in its children_order, the rest alphabetically", () => {
    const parent = note("p", "Parent", { childrenOrder: ["c", "unknown", "b"] });
    const notes = [parent, ...kids().map((k) => ({ ...k, parent: "p" }))];
    expect(titles(build(notes).children.get("p")!)).toEqual(["Cherry", "banana", "Apple"]);
  });

  it("falls back to alphabetical without an order", () => {
    const parent = note("p", "Parent");
    const notes = [parent, ...kids().map((k) => ({ ...k, parent: "p" }))];
    expect(titles(build(notes).children.get("p")!)).toEqual(["Apple", "banana", "Cherry"]);
  });
});
