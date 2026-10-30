import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../../../lib/vault/types";
import { flatten, foldKey, parentsOf } from "./subitems";

/** A note `id` titled "T-id" inside `parent` (an id), in file `library/id.md`. */
function note(id: string, parent: string | null = null): NoteMeta {
  return {
    path: `library/${id}.md`,
    id,
    title: `T-${id}`,
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
  };
}

const ids = (rows: { note: NoteMeta }[]) => rows.map((r) => r.note.id);
const none = new Set<string>();
const open = (...keys: string[]) => new Set(keys);

describe("flatten", () => {
  const tree = [note("a"), note("a1", "a"), note("a2", "a"), note("a1x", "a1"), note("b"), note("b1", "b")];

  it("shows only the top-level rows while nothing is expanded, with their folds", () => {
    const { rows } = flatten(tree, tree, none);
    expect(ids(rows)).toEqual(["a", "b"]);
    expect(rows.map((r) => r.fold)).toEqual(["closed", "closed"]);
    expect(rows.every((r) => r.depth === 0 && !r.dim)).toBe(true);
  });

  it("opens a row's children under it, one step deeper, in the order given", () => {
    const { rows } = flatten(tree, tree, open("a"));
    expect(ids(rows)).toEqual(["a", "a1", "a2", "b"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
    expect(rows.map((r) => r.fold)).toEqual(["open", "closed", "leaf", "closed"]);
  });

  it("goes down to any depth", () => {
    const { rows } = flatten(tree, tree, open("a", "a1"));
    expect(ids(rows)).toEqual(["a", "a1", "a1x", "a2", "b"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
    // A child of a collapsed row stays hidden even if it is itself marked open.
    expect(ids(flatten(tree, tree, open("a1")).rows)).toEqual(["a", "b"]);
  });

  it("keeps the order the rows came in, within each set of siblings", () => {
    const shuffled = [tree[4]!, tree[2]!, tree[0]!, tree[3]!, tree[1]!, tree[5]!];
    expect(ids(flatten(shuffled, shuffled, open("a", "a1", "b")).rows)).toEqual(["b", "b1", "a", "a2", "a1", "a1x"]);
  });

  it("opens by id, and by path for a note without an id", () => {
    const loose = { ...note("x"), id: null };
    const kid = { ...note("y"), parent: null, path: "library/y.md" };
    expect(foldKey(loose)).toBe("library/x.md");
    expect(foldKey(kid)).toBe("y");
    expect(ids(flatten([loose], [loose], none).rows)).toEqual([null]);
  });

  it("treats a row whose parent is not a row of the view as top level (an orphan)", () => {
    const rows = [note("c", "gone"), note("d", "c")];
    const flat = flatten(rows, rows, open("c"));
    expect(ids(flat.rows)).toEqual(["c", "d"]);
    expect(flat.rows.map((r) => r.depth)).toEqual([0, 1]);
  });

  it("survives a note that is its own parent and a ring of parents", () => {
    const self = note("s", "s");
    expect(ids(flatten([self], [self], none).rows)).toEqual(["s"]);
    const ring = [note("p", "q"), note("q", "r"), note("r", "p"), note("z")];
    const flat = flatten(ring, ring, open("p", "q", "r"));
    // Every row appears exactly once.
    expect([...ids(flat.rows)].sort()).toEqual(["p", "q", "r", "z"]);
    expect(flat.rows.length).toBe(4);
  });

  it("shows a matching child with its ancestors, greyed, opened, and not counted", () => {
    const shown = [tree[3]!]; // only a1x matches
    const flat = flatten(shown, tree, none);
    expect(ids(flat.rows)).toEqual(["a", "a1", "a1x"]);
    expect(flat.rows.map((r) => r.dim)).toEqual([true, true, false]);
    expect(flat.rows.map((r) => r.depth)).toEqual([0, 1, 2]);
    expect(flat.matching).toBe(1);
  });

  it("does not grey a matching parent, and keeps a collapsed matching parent collapsed", () => {
    const shown = [tree[0]!, tree[3]!]; // a and a1x match; a1 does not
    const flat = flatten(shown, tree, none);
    expect(ids(flat.rows)).toEqual(["a"]);
    expect(flat.rows[0]!.dim).toBe(false);
    expect(flat.rows[0]!.fold).toBe("closed");
    const opened = flatten(shown, tree, open("a"));
    expect(ids(opened.rows)).toEqual(["a", "a1", "a1x"]);
    expect(opened.rows.map((r) => r.dim)).toEqual([false, true, false]);
    expect(opened.matching).toBe(2);
  });

  it("leaves out children that do not match, and counts matching rows only", () => {
    const shown = [tree[0]!, tree[1]!, tree[5]!]; // a, a1, b1
    const flat = flatten(shown, tree, open("a", "b"));
    expect(ids(flat.rows)).toEqual(["a", "a1", "b", "b1"]);
    expect(flat.rows.map((r) => r.dim)).toEqual([false, false, true, false]);
    expect(flat.rows[1]!.fold).toBe("leaf");
    expect(flat.matching).toBe(3);
  });

  it("orders the greyed ancestors among their siblings as the pool is ordered", () => {
    const pool = [note("m"), note("n"), note("n1", "n"), note("o")];
    const flat = flatten([pool[3]!, pool[2]!], pool, none);
    expect(ids(flat.rows)).toEqual(["n", "n1", "o"]);
  });

  it("takes a revealed row that the pool lacks as a row of its own", () => {
    const extra = note("e", "a");
    const flat = flatten([...tree, extra], tree, open("a"));
    expect(ids(flat.rows)).toContain("e");
    expect(flat.rows.find((r) => r.note.id === "e")!.depth).toBe(1);
  });

  it("is quick at three levels of ten thousand rows, and never loses a row", () => {
    const rows: NoteMeta[] = [];
    rows.push(note("extra"));
    for (let i = 0; i < 99; i++) {
      rows.push(note(`r${i}`));
      for (let j = 0; j < 10; j++) {
        rows.push(note(`r${i}c${j}`, `r${i}`));
        for (let k = 0; k < 9; k++) rows.push(note(`r${i}c${j}g${k}`, `r${i}c${j}`));
      }
    }
    expect(rows.length).toBe(10_000);
    const everything = new Set(parentsOf(rows));
    const started = performance.now();
    const closed = flatten(rows, rows, none);
    const all = flatten(rows, rows, everything);
    const took = performance.now() - started;
    expect(closed.rows.length).toBe(100);
    expect(all.rows.length).toBe(10_000);
    expect(Math.max(...all.rows.map((r) => r.depth))).toBe(2);
    expect(took).toBeLessThan(1500);
  });

  it("copes with a very long chain without running out of stack", () => {
    const chain = Array.from({ length: 5000 }, (_, i) => note(`c${i}`, i === 0 ? null : `c${i - 1}`));
    const flat = flatten(chain, chain, new Set(parentsOf(chain)));
    expect(flat.rows.length).toBe(5000);
    expect(flat.rows[4999]!.depth).toBe(4999);
  });
});

describe("parentsOf", () => {
  it("lists the keys of rows that have a child among the rows, for Expand all", () => {
    const rows = [note("a"), note("a1", "a"), note("b", "gone"), note("a1x", "a1")];
    expect(parentsOf(rows).sort()).toEqual(["a", "a1"]);
  });
});
