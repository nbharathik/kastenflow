import type { Section, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { FRAME, LIST_PAD, ROW_PAD, SECTION_H, entryOf, gapAt, gapShifts, gapTop, layoutFilmstrip, sectionOf, thumbHeight, visibleIds } from "./model.ts";

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const size = { w: 960, h: 540 };
const ROW = thumbHeight(size) + FRAME + 2 * ROW_PAD;
const deck = (ids: string[], sections: Section[] = [], extra: Record<string, Partial<Slide>> = {}) => ({
  slides: ids.map((id) => slide(id, extra[id])),
  sections,
  size,
});

describe("thumbHeight", () => {
  it("keeps the shape of the slides", () => {
    expect(thumbHeight(size)).toBe(90);
    expect(thumbHeight({ w: 720, h: 540 })).toBe(120);
    expect(thumbHeight(size, 260)).toBe(146);
  });
});

describe("layoutFilmstrip", () => {
  it("stacks rows of one height", () => {
    const layout = layoutFilmstrip(deck(["a", "b", "c"]), new Set());
    expect(layout.rowHeight).toBe(ROW);
    expect(layout.entries.map((entry) => entry.top)).toEqual([LIST_PAD, LIST_PAD + ROW, LIST_PAD + 2 * ROW]);
    expect(layout.height).toBe(LIST_PAD * 2 + 3 * ROW);
    expect(visibleIds(layout)).toEqual(["a", "b", "c"]);
  });

  it("puts a header where a section starts", () => {
    const layout = layoutFilmstrip(deck(["a", "b", "c", "d"], [{ title: "Part two", startsAt: "c" }]), new Set());
    expect(layout.entries.map((entry) => (entry.kind === "header" ? `#${entry.section.title}` : entry.id))).toEqual(["a", "b", "#Part two", "c", "d"]);
    const header = layout.entries[2]!;
    expect(header).toMatchObject({ kind: "header", first: 2, count: 2, collapsed: false, top: LIST_PAD + 2 * ROW, height: SECTION_H });
    expect(entryOf(layout, "c")?.top).toBe(LIST_PAD + 2 * ROW + SECTION_H);
  });

  it("leaves out the slides of a section that is collapsed", () => {
    const sections = [
      { title: "One", startsAt: "a" },
      { title: "Two", startsAt: "c" },
    ];
    const layout = layoutFilmstrip(deck(["a", "b", "c", "d", "e"], sections), new Set(["a"]));
    expect(layout.entries.map((entry) => (entry.kind === "header" ? `#${entry.section.title}` : entry.id))).toEqual(["#One", "#Two", "c", "d", "e"]);
    expect(layout.entries[0]).toMatchObject({ collapsed: true, count: 2 });
    expect(visibleIds(layout)).toEqual(["c", "d", "e"]);
    expect(entryOf(layout, "b")).toBeUndefined();
  });

  it("ignores a section that starts at a slide the deck does not have, and a second one at the same slide", () => {
    const sections = [
      { title: "Lost", startsAt: "zz" },
      { title: "First", startsAt: "b" },
      { title: "Second", startsAt: "b" },
    ];
    const layout = layoutFilmstrip(deck(["a", "b"], sections), new Set());
    expect(layout.entries.filter((entry) => entry.kind === "header")).toHaveLength(1);
    expect(layout.entries[1]).toMatchObject({ kind: "header", section: { title: "First" } });
  });

  it("marks backup slides, except a first one, which cannot be", () => {
    const layout = layoutFilmstrip(deck(["a", "b", "c"], [], { a: { backup: true }, c: { backup: true } }), new Set());
    expect(layout.entries.map((entry) => entry.kind === "slide" && entry.backup)).toEqual([false, false, true]);
  });
});

describe("sectionOf", () => {
  it("names the section a slide is in", () => {
    const d = deck(["a", "b", "c", "d"], [{ title: "Part two", startsAt: "c" }]);
    expect(sectionOf(d, "a")).toBeUndefined();
    expect(sectionOf(d, "c")?.title).toBe("Part two");
    expect(sectionOf(d, "d")?.title).toBe("Part two");
  });
});

describe("gapAt and gapTop", () => {
  const layout = layoutFilmstrip(deck(["a", "b", "c", "d"], [{ title: "Two", startsAt: "c" }]), new Set());
  const top = (id: string) => entryOf(layout, id)!.top;

  it("says which gap a height in the list is at, by the middle of each row", () => {
    expect(gapAt(layout, 0, 4)).toBe(0);
    expect(gapAt(layout, top("a") + ROW / 2 - 1, 4)).toBe(0);
    expect(gapAt(layout, top("a") + ROW / 2 + 1, 4)).toBe(1);
    expect(gapAt(layout, top("b") + ROW - 1, 4)).toBe(2);
    expect(gapAt(layout, top("d") + ROW - 1, 4)).toBe(4);
    expect(gapAt(layout, 99999, 4)).toBe(4);
  });

  it("takes a header for the gap before its section", () => {
    const header = layout.entries[2]!;
    expect(gapAt(layout, header.top + 2, 4)).toBe(2);
    // Under the middle of the header is the gap before the section's first slide: the same one.
    expect(gapAt(layout, header.top + SECTION_H - 1, 4)).toBe(2);
  });

  it("draws the line for a gap at the top of its row, or of its header, or at the end", () => {
    expect(gapTop(layout, 0)).toBe(top("a"));
    expect(gapTop(layout, 1)).toBe(top("b"));
    expect(gapTop(layout, 2)).toBe(layout.entries[2]!.top);
    expect(gapTop(layout, 4)).toBe(top("d") + ROW);
  });

  it("puts a gap after a collapsed section at the header's foot", () => {
    const folded = layoutFilmstrip(deck(["a", "b", "c", "d"], [{ title: "Two", startsAt: "c" }]), new Set(["c"]));
    const header = folded.entries[2]!;
    expect(gapAt(folded, header.top + header.height - 1, 4)).toBe(4);
    expect(gapTop(folded, 4)).toBe(header.top + header.height);
  });
});

describe("gapShifts", () => {
  const five = layoutFilmstrip(deck(["a", "b", "c", "d", "e"]), new Set());

  it("closes the rows up behind slides in the hand, and opens a gap where they would land", () => {
    // b pulled to the gap before e: c and d close up one row, and e stays where the gap leaves it.
    const down = gapShifts(five, new Set(["b"]), 4);
    expect([...down.rows]).toEqual([
      ["c", -ROW],
      ["d", -ROW],
    ]);
    // d pulled up to the gap before b: b and c make room, one row down.
    const up = gapShifts(five, new Set(["d"]), 1);
    expect([...up.rows]).toEqual([
      ["b", ROW],
      ["c", ROW],
    ]);
  });

  it("moves nothing when the slides would land where they were", () => {
    for (const gap of [1, 2]) expect(gapShifts(five, new Set(["b"]), gap).rows.size).toBe(0);
    expect(gapShifts(five, new Set(["b", "c"]), 1).rows.size).toBe(0);
    expect(gapShifts(five, new Set(["b", "c"]), 3).rows.size).toBe(0);
  });

  it("makes room for as many rows as there are slides in the hand", () => {
    // b and c pulled to the end: d and e close up two rows.
    expect([...gapShifts(five, new Set(["b", "c"]), 5).rows]).toEqual([
      ["d", -2 * ROW],
      ["e", -2 * ROW],
    ]);
    // d and e pulled to the start: a, b and c go down two rows.
    expect([...gapShifts(five, new Set(["d", "e"]), 0).rows]).toEqual([
      ["a", 2 * ROW],
      ["b", 2 * ROW],
      ["c", 2 * ROW],
    ]);
  });

  it("moves a section's header with its slides", () => {
    const sectioned = layoutFilmstrip(deck(["a", "b", "c", "d"], [{ title: "Two", startsAt: "c" }]), new Set());
    // a pulled to the end: b, the header of "Two", c and d all close up one row.
    const shifts = gapShifts(sectioned, new Set(["a"]), 4);
    expect([...shifts.rows]).toEqual([
      ["b", -ROW],
      ["c", -ROW],
      ["d", -ROW],
    ]);
    expect([...shifts.headers]).toEqual([["c", -ROW]]);
  });

  it("leaves out the slides of a folded section, which are not in the list to be moved", () => {
    const folded = layoutFilmstrip(deck(["a", "b", "c"], [{ title: "Two", startsAt: "b" }]), new Set(["b"]));
    // c is in the hand but out of sight, so it leaves no hole and needs no gap: nothing in the list moves.
    const shifts = gapShifts(folded, new Set(["c"]), 0);
    expect(shifts.rows.size + shifts.headers.size).toBe(0);
  });
});
