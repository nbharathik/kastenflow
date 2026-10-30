import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../../../lib/vault/types";
import { addToBoardChanges, moveChanges, removeTagChanges, setPropertyChanges, tagChanges, tooMany } from "./bulk-changes";

function note(path: string, more: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path, id: `id-${path}`, title: path, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["task"],
    modified: 0, created: null, updated: null, excerpt: "", words: 0, props: {}, locked: false, ...more,
  };
}
const A = note("library/a.md", { props: { status: "Todo" } });
const B = note("library/b.md", { tags: ["task", "Idea"], props: { status: "Done" } });
const C = note("library/c.md");

describe("set a property", () => {
  it("is one update_props per row that does not have the value", () => {
    const run = setPropertyChanges([A, B, C], "status", "Done");
    expect(run.changes).toEqual([
      { kind: "update_props", path: "library/a.md", props: { status: "Done" } },
      { kind: "update_props", path: "library/c.md", props: { status: "Done" } },
    ]);
    expect(run.skipped).toBe(1);
  });

  it("clears with null, and a row with nothing there is left alone", () => {
    const run = setPropertyChanges([A, C], "status", null);
    expect(run.changes).toEqual([{ kind: "update_props", path: "library/a.md", props: { status: null } }]);
    expect(run.skipped).toBe(1);
  });

  it("compares lists as they are", () => {
    const row = note("library/d.md", { props: { labels: ["ui", "core"] } });
    expect(setPropertyChanges([row], "labels", ["ui", "core"]).changes).toEqual([]);
    expect(setPropertyChanges([row], "labels", ["ui"]).changes).toHaveLength(1);
  });
});

describe("tags", () => {
  it("adds a tag to the rows that lack it, whatever its case", () => {
    const run = tagChanges([A, B], "idea");
    expect(run.changes).toEqual([{ kind: "tags", path: "library/a.md", add: ["idea"], remove: [] }]);
    expect(run.skipped).toBe(1);
  });

  it("takes a tag off in the spelling the row has", () => {
    const run = removeTagChanges([A, B], "idea");
    expect(run.changes).toEqual([{ kind: "tags", path: "library/b.md", add: [], remove: ["Idea"] }]);
    expect(run.skipped).toBe(1);
  });
});

describe("move to a project", () => {
  const all = [A, B, C];

  it("moves each row that is not there already", () => {
    const inWeb = note("projects/web/x.md", { project: "web" });
    const run = moveChanges([A, inWeb], [...all, inWeb], "web");
    expect(run.changes).toEqual([{ kind: "move", path: "library/a.md", project: "web" }]);
    expect(run.skipped).toBe(1);
  });

  it("moves to the library with no project", () => {
    const inWeb = note("projects/web/x.md", { project: "web" });
    expect(moveChanges([inWeb, A], [...all, inWeb], null).changes).toEqual([{ kind: "move", path: "projects/web/x.md", project: null }]);
  });

  it("leaves journal days and projects, and a sub-page that goes with its page", () => {
    const day = note("journal/2026-10-02.md", { kind: "journal" });
    const parent = note("library/p.md", { id: "p1" });
    const child = note("library/q.md", { parent: "p1" });
    const run = moveChanges([day, parent, child], [day, parent, child], "web");
    expect(run.changes).toEqual([{ kind: "move", path: "library/p.md", project: "web" }]);
    expect(run.skipped).toBe(2);
  });
});

describe("add to a board", () => {
  it("is one change holding every row, in table order", () => {
    expect(addToBoardChanges("boards/plan.canvas", [A, B, C])).toEqual([{ kind: "add_to_board", board: "boards/plan.canvas", notes: ["library/a.md", "library/b.md", "library/c.md"], layout: "grid" }]);
  });
});

describe("how many rows one action takes", () => {
  it("is up to a hundred changes", () => {
    expect(tooMany(100)).toBeNull();
    expect(tooMany(101)).toBe("You can change up to 100 rows at once and this would change 101. Pick fewer and try again.");
  });
});
