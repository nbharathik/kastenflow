import type { StoryEntry } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { blocksBefore, edit, entriesOf, evidenceFromText, evidenceToText, leaveOut, merge, move, nameOf, rowsOf, split, tally } from "./model";

const source = (section: string) => ({ page: "library/plan.md", id: "n-1", title: "Plan", section, markdown: `## ${section}\n\n- x` });
const entry = (title: string, extra: Partial<StoryEntry> = {}): StoryEntry => ({ title, evidence: [], media: false, sources: [source(title)], ...extra });

const drafted = () => rowsOf([entry("Plan", { point: "Book early.", evidence: ["- flights", "  - morning", "- guesthouse"], notes: "Book early. Then pack." }), entry("Budget", { evidence: ["| a | b |\n| --- | --- |\n| 1 | 2 |"], media: true }), entry("Thanks")]);

describe("the rows of a storyboard", () => {
  it("are the drafted entries, in order, each with a key of its own, none left out", () => {
    const rows = drafted();
    expect(rows.map((r) => r.entry.title)).toEqual(["Plan", "Budget", "Thanks"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(rows.every((r) => !r.leftOut)).toBe(true);
  });

  it("are named by their title, or by their place when they have none", () => {
    const rows = rowsOf([entry("Plan"), entry(" ")]);
    expect(nameOf(rows[0]!.entry, 0)).toBe("Plan");
    expect(nameOf(rows[1]!.entry, 1)).toBe("Slide 2");
  });
});

describe("reordering", () => {
  it("moves a row to another place and keeps the others in their order", () => {
    const rows = drafted();
    expect(move(rows, 0, 2).map((r) => r.entry.title)).toEqual(["Budget", "Thanks", "Plan"]);
    expect(move(rows, 2, 0).map((r) => r.entry.title)).toEqual(["Thanks", "Plan", "Budget"]);
    expect(move(rows, 1, 1)).toBe(rows);
  });

  it("stays inside the list: a move past either end goes to the end, and a place that is not there changes nothing", () => {
    const rows = drafted();
    expect(move(rows, 0, 9).map((r) => r.entry.title)).toEqual(["Budget", "Thanks", "Plan"]);
    expect(move(rows, 0, -4).map((r) => r.entry.title)).toEqual(["Plan", "Budget", "Thanks"]);
    expect(move(rows, 7, 0)).toBe(rows);
  });
});

describe("leaving a slide out", () => {
  it("marks the row, keeps it in the list so it can be put back, and leaves it out of what is made", () => {
    const rows = leaveOut(drafted(), 1);
    expect(rows[1]?.leftOut).toBe(true);
    expect(rows).toHaveLength(3);
    expect(entriesOf(rows).map((e) => e.title)).toEqual(["Plan", "Thanks"]);
    expect(entriesOf(leaveOut(rows, 1, false)).map((e) => e.title)).toEqual(["Plan", "Budget", "Thanks"]);
  });
});

describe("editing the fields", () => {
  it("changes the title, the point, the notes, the evidence and the layout of one row and nothing else", () => {
    const rows = drafted();
    const changed = edit(rows, 0, { title: "The plan", point: "Go early.", notes: "Say it twice.", layout: "title-only", evidence: ["- one"] });
    expect(changed[0]?.entry).toMatchObject({ title: "The plan", point: "Go early.", notes: "Say it twice.", layout: "title-only", evidence: ["- one"] });
    expect(changed[1]).toBe(rows[1]);
    expect(changed[0]?.entry.sources).toEqual(rows[0]?.entry.sources);
  });

  it("takes an empty point, notes or layout away, and works out again whether there is media", () => {
    const rows = drafted();
    const cleared = edit(rows, 0, { point: "  ", notes: "", layout: "" });
    expect(cleared[0]?.entry.point).toBeUndefined();
    expect(cleared[0]?.entry.notes).toBeUndefined();
    expect(cleared[0]?.entry.layout).toBeUndefined();
    expect(edit(rows, 0, { evidence: ["![x](assets/x.png)"] })[0]?.entry.media).toBe(true);
    expect(edit(rows, 1, { evidence: ["- just a list"] })[1]?.entry.media).toBe(false);
  });

  it("changes nothing for a row that is not there", () => {
    const rows = drafted();
    expect(edit(rows, 9, { title: "x" })).toBe(rows);
  });
});

describe("merging", () => {
  it("joins a row and the one after it into the first: its title, both points as the first one's or else the second's, both evidences, both notes, all sources", () => {
    const rows = drafted();
    const merged = merge(rows, 0);
    expect(merged).toHaveLength(2);
    const joined = merged[0]!.entry;
    expect(joined.title).toBe("Plan");
    expect(joined.point).toBe("Book early.");
    expect(joined.evidence).toEqual(["- flights", "  - morning", "- guesthouse", "| a | b |\n| --- | --- |\n| 1 | 2 |"]);
    expect(joined.media).toBe(true);
    expect(joined.sources.map((s) => s.section)).toEqual(["Plan", "Budget"]);
    expect(joined.notes).toBe("Book early. Then pack.");
    expect(merged[1]?.entry.title).toBe("Thanks");
  });

  it("takes the second point when the first has none, and joins notes with a blank line", () => {
    const rows = rowsOf([entry("A", { notes: "one" }), entry("B", { point: "Second.", notes: "two" })]);
    const joined = merge(rows, 0)[0]!.entry;
    expect(joined.point).toBe("Second.");
    expect(joined.notes).toBe("one\n\ntwo");
  });

  it("is left out only if both were, and does nothing for the last row", () => {
    const rows = rowsOf([entry("A"), entry("B")]);
    expect(merge(leaveOut(leaveOut(rows, 0), 1), 0)[0]?.leftOut).toBe(true);
    expect(merge(leaveOut(rows, 0), 0)[0]?.leftOut).toBe(false);
    expect(merge(rows, 1)).toBe(rows);
  });

  it("gives the new row a key of its own", () => {
    const rows = drafted();
    const merged = merge(rows, 0);
    expect(new Set([...rows.map((r) => r.key), merged[0]!.key]).size).toBe(4);
  });
});

describe("splitting", () => {
  it("cuts the evidence in two at a place: the first part stays as the row, the rest becomes a slide after it that remembers no page", () => {
    const rows = drafted();
    const parted = split(rows, 0, 2);
    expect(parted).toHaveLength(4);
    expect(parted[0]?.entry.evidence).toEqual(["- flights", "  - morning"]);
    expect(parted[0]?.entry.point).toBe("Book early.");
    expect(parted[0]?.entry.sources).toEqual(rows[0]?.entry.sources);
    expect(parted[1]?.entry).toMatchObject({ title: "Plan (2)", evidence: ["- guesthouse"], sources: [] });
    expect(parted[1]?.entry.point).toBeUndefined();
    expect(parted[2]?.entry.title).toBe("Budget");
  });

  it("does nothing at a place that leaves nothing on one side", () => {
    const rows = drafted();
    expect(split(rows, 0, 0)).toBe(rows);
    expect(split(rows, 0, 3)).toBe(rows);
    expect(split(rows, 2, 1)).toBe(rows);
  });

  it("works out which part has media after the cut", () => {
    const rows = rowsOf([entry("A", { evidence: ["- a", "![p](assets/p.png)"], media: true })]);
    const parted = split(rows, 0, 1);
    expect(parted.map((r) => r.entry.media)).toEqual([false, true]);
  });
});

describe("what is made", () => {
  it("is the rows that are not left out, in their order, with media worked out", () => {
    const rows = leaveOut(edit(drafted(), 2, { evidence: ["```ts\nlet x;\n```"] }), 0);
    const made = entriesOf(rows);
    expect(made.map((e) => e.title)).toEqual(["Budget", "Thanks"]);
    expect(made[1]?.media).toBe(true);
  });

  it("is counted: how many slides, how many are left out", () => {
    expect(tally(leaveOut(drafted(), 1))).toEqual({ slides: 2, leftOut: 1 });
  });
});

describe("evidence as text", () => {
  it("writes list items one under the other and every other block apart, and reads it back", () => {
    const blocks = ["- flights", "  - morning", "- guesthouse", "![The bay](assets/bay.png)", "| a | b |\n| --- | --- |\n| 1 | 2 |", "```rs\nfn main() {}\n\nfn two() {}\n```", "$$\nx^2\n$$", "- last"];
    const text = evidenceToText(blocks);
    expect(text).toBe("- flights\n  - morning\n- guesthouse\n\n![The bay](assets/bay.png)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```rs\nfn main() {}\n\nfn two() {}\n```\n\n$$\nx^2\n$$\n\n- last");
    expect(evidenceFromText(text)).toEqual(blocks);
  });

  it("reads each list line as an item of its own, whatever the indent, and ignores blank lines between items", () => {
    expect(evidenceFromText("- a\n\n- b\n   - c\n1. d")).toEqual(["- a", "- b", "   - c", "1. d"]);
    expect(evidenceFromText("")).toEqual([]);
    expect(evidenceFromText("\n\n  \n")).toEqual([]);
  });

  it("keeps a fence whole, blank lines in it too, and one that is never closed holds the rest", () => {
    expect(evidenceFromText("- a\n~~~\none\n\ntwo\n~~~\n- b")).toEqual(["- a", "~~~\none\n\ntwo\n~~~", "- b"]);
    expect(evidenceFromText("```\nopen\n\nstill")).toEqual(["```\nopen\n\nstill"]);
  });

  it("keeps a block formula whole and counts the blocks before a place in the text", () => {
    expect(evidenceFromText("$$\na\n\nb\n$$\n- x")).toEqual(["$$\na\n\nb\n$$", "- x"]);
    const text = "- a\n- b\n\n![p](assets/p.png)\n- c";
    expect(blocksBefore(text, 0)).toBe(0);
    expect(blocksBefore(text, 4)).toBe(1);
    expect(blocksBefore(text, text.indexOf("![p]"))).toBe(2);
    expect(blocksBefore(text, text.indexOf("- c"))).toBe(3);
    expect(blocksBefore(text, text.length)).toBe(4);
  });
});
