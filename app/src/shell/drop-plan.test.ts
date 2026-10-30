import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../lib/vault/types";
import { dropPlan } from "./drop-plan";

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

// Parent P holds Apple, Banana, Cherry (that order); Other is a page of its
// own; Deep sits inside Apple.
const notes = (): NoteMeta[] => [
  note("p", "Parent", { childrenOrder: ["a", "b", "c"] }),
  note("a", "Apple", { parent: "p" }),
  note("b", "Banana", { parent: "p" }),
  note("c", "Cherry", { parent: "p" }),
  note("o", "Other"),
  note("d", "Deep", { parent: "a" }),
];
const at = (list: NoteMeta[], id: string) => list.find((n) => n.id === id)!;
const MIDDLE = 0.5;

describe("dropPlan", () => {
  it("nests onto the middle of a page row", () => {
    const list = notes();
    const plan = dropPlan(list, [at(list, "o").path], at(list, "p"), MIDDLE);
    expect(plan).toMatchObject({ kind: "into" });
  });

  it("reorders when dropped on the edge of a sibling", () => {
    const list = notes();
    expect(dropPlan(list, [at(list, "c").path], at(list, "a"), 0.1)).toMatchObject({ kind: "beside", moved: "c", target: "a", after: false, edge: "before" });
    expect(dropPlan(list, [at(list, "a").path], at(list, "c"), 0.9)).toMatchObject({ kind: "beside", moved: "a", target: "c", after: true, edge: "after" });
  });

  it("does nothing for an edge drop that leaves the order as it is", () => {
    const list = notes();
    expect(dropPlan(list, [at(list, "a").path], at(list, "b"), 0.1)).toBeNull();
    expect(dropPlan(list, [at(list, "a").path], at(list, "a"), 0.1)).toBeNull();
  });

  it("takes a page out of its page on the edge of a top-level row", () => {
    const list = notes();
    expect(dropPlan(list, [at(list, "d").path], at(list, "o"), 0.9)).toMatchObject({ kind: "out", parent: null, edge: "after" });
  });

  it("puts a page in the page of the row whose edge it is dropped on", () => {
    const list = notes();
    expect(dropPlan(list, [at(list, "o").path], at(list, "b"), 0.1)).toMatchObject({ kind: "out", parent: at(list, "p").path, edge: "before" });
  });

  it("refuses a page dropped into itself or its own sub-page with one sentence", () => {
    const list = notes();
    expect(dropPlan(list, [at(list, "a").path], at(list, "d"), MIDDLE)).toEqual({ kind: "refuse", why: "A page cannot go inside itself or its own sub-page." });
    expect(dropPlan(list, [at(list, "a").path], at(list, "d"), 0.1)).toEqual({ kind: "refuse", why: "A page cannot go inside itself or its own sub-page." });
  });

  it("does not count passing over the row being dragged", () => {
    const list = notes();
    expect(dropPlan(list, [at(list, "a").path], at(list, "a"), MIDDLE)).toBeNull();
  });

  it("takes a drag from another window onto the middle only", () => {
    const list = notes();
    expect(dropPlan(list, null, at(list, "p"), MIDDLE)).toMatchObject({ kind: "into" });
    expect(dropPlan(list, null, at(list, "p"), 0.1)).toBeNull();
  });

  it("leaves rows that hold no pages to the project around them", () => {
    const list = [...notes(), note("k", "Quick", { kind: "card" })];
    expect(dropPlan(list, [at(list, "o").path], at(list, "k"), MIDDLE)).toBeNull();
  });
});
