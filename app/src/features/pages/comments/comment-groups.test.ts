// A page's comments sorted into stacks: by section, the page as a whole, and
// the ones that lost their place; open before resolved, then in the order of
// the words they are about, then as they were made.

import { describe, expect, it } from "vitest";

import type { PageComment } from "../../../lib/vault/annotation-types";
import type { Place } from "../../annotations/anchor";
import { authorName, openIn, stacksOf, type PlacedComment } from "./comment-groups";

const comment = (id: string, resolved = false): PageComment => ({ id, anchor: { section: "", nth: 1 }, text: id, author: "you", created: null, resolved: resolved ? { at: "t", by: "you" } : null });
const at = (id: string, place: Place, resolved = false): PlacedComment => ({ comment: comment(id, resolved), place });
const ids = (list: PlacedComment[]) => list.map((item) => item.comment.id);

describe("stacks", () => {
  it("put each comment where its place says", () => {
    const stacks = stacksOf(
      [
        at("a", { kind: "section", section: 1, range: null }),
        at("b", { kind: "page", range: null }),
        at("c", { kind: "detached" }),
        at("d", { kind: "quote", section: 0, range: { from: 3, to: 5 } }),
        at("e", { kind: "section", section: 1, range: null }),
      ],
      3,
    );
    expect(ids(stacks.page)).toEqual(["b"]);
    expect(stacks.sections.map(ids)).toEqual([["d"], ["a", "e"], []]);
    expect(ids(stacks.detached)).toEqual(["c"]);
  });

  it("order the open ones first, then by the words' place, then as made", () => {
    const stacks = stacksOf(
      [
        at("late", { kind: "section", section: 0, range: { from: 40, to: 45 } }),
        at("none", { kind: "section", section: 0, range: null }),
        at("done", { kind: "section", section: 0, range: { from: 1, to: 2 } }, true),
        at("early", { kind: "section", section: 0, range: { from: 10, to: 15 } }),
        at("none-2", { kind: "section", section: 0, range: null }),
      ],
      1,
    );
    expect(ids(stacks.sections[0]!)).toEqual(["early", "late", "none", "none-2", "done"]);
  });

  it("always have a stack for a page with no sections, and drop a section that is not there into the page's", () => {
    expect(stacksOf([], 0).sections).toHaveLength(1);
    const stacks = stacksOf([at("x", { kind: "section", section: 7, range: null })], 2);
    expect(ids(stacks.page)).toEqual(["x"]);
  });

  it("count the open comments", () => {
    const list = [at("a", { kind: "page", range: null }), at("b", { kind: "page", range: null }, true)];
    expect(openIn(list)).toBe(1);
    expect(openIn([])).toBe(0);
  });
});

describe("authors", () => {
  it("name a person and an agent", () => {
    expect(authorName("you")).toEqual({ name: "You", agent: false });
    expect(authorName("")).toEqual({ name: "You", agent: false });
    expect(authorName("agent:claude-code")).toEqual({ name: "claude-code", agent: true });
    expect(authorName("agent:")).toEqual({ name: "agent", agent: true });
    expect(authorName("someone else")).toEqual({ name: "someone else", agent: false });
  });
});
