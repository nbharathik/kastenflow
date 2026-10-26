import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { merged, patched, sameMeta, sameShape, upserted } from "./note-list";

const meta = (path: string, extra: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title: path,
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...extra,
});

describe("note list", () => {
  it("compares what a meta says", () => {
    expect(sameMeta(meta("a.md"), meta("a.md"))).toBe(true);
    expect(sameMeta(meta("a.md"), meta("a.md", { modified: 2 }))).toBe(false);
    expect(sameMeta(meta("a.md", { tags: ["x"] }), meta("a.md", { tags: ["y"] }))).toBe(false);
    expect(sameMeta(meta("a.md", { props: { due: "2026-10-01" } }), meta("a.md", { props: { due: "2026-10-01" } }))).toBe(true);
  });

  it("adds in path order and replaces in place", () => {
    const list = [meta("a.md"), meta("c.md")];
    const added = upserted(list, meta("b.md"));
    expect(added.map((n) => n.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(added[0]).toBe(list[0]);
    expect(upserted(added, meta("b.md"))).toBe(added);
    const changed = upserted(added, meta("b.md", { title: "Bee" }));
    expect(changed[1]!.title).toBe("Bee");
    expect(changed[2]).toBe(added[2]);
  });

  it("returns the same list when only the counts, excerpt and times change", () => {
    const list = [meta("a.md"), meta("b.md")];
    const typed = upserted(list, meta("b.md", { words: 40, excerpt: "Hello there", modified: 99, updated: "2026-10-22T10:00:00Z" }));
    expect(typed).toBe(list);
    expect(typed[1]!.words).toBe(0);
    expect(upserted(list, meta("b.md", { words: 40, tags: ["x"] }))).not.toBe(list);
    expect(upserted(list, meta("b.md", { icon: "star" }))).not.toBe(list);
    expect(sameShape(meta("b.md"), meta("b.md", { words: 3, modified: 5 }))).toBe(true);
    expect(sameShape(meta("b.md"), meta("b.md", { title: "B" }))).toBe(false);
  });

  it("keeps unchanged notes when the full list comes back", () => {
    const old = [meta("a.md"), meta("b.md")];
    expect(merged(old, [meta("a.md"), meta("b.md")])).toBe(old);
    const next = merged(old, [meta("a.md"), meta("b.md", { words: 3 }), meta("c.md")]);
    expect(next[0]).toBe(old[0]);
    expect(next[1]).not.toBe(old[1]);
    expect(next).toHaveLength(3);
  });

  it("patches the paths the watcher reported", () => {
    const old = [meta("a.md"), meta("b.md"), meta("c.md")];
    const next = patched(old, ["b.md", "d.md", "e.canvas", "a.md"], [meta("d.md"), meta("a.md", { title: "A" })]);
    expect(next.map((n) => [n.path, n.title])).toEqual([
      ["a.md", "A"],
      ["c.md", "c.md"],
      ["d.md", "d.md"],
    ]);
    expect(next[1]).toBe(old[2]);
    expect(patched(old, ["x.canvas"], [])).toBe(old);
  });
});
