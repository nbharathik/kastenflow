// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ListStyle, Paragraph } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { defaultStyle, hangsByLevel, kindOfStyle, layoutParagraphs, levelOf, listNumbers, markerFor, markerText, markerTexts, styleOf } from "./lists.ts";

const item = (list: "bullet" | "number" | null, level?: number): Paragraph => ({ runs: [{ t: "x" }], ...(list ? { list } : {}), ...(level === undefined ? {} : { level }) });

describe("markerFor", () => {
  it("draws bullets by level and starts again after the third", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((level) => markerFor(item("bullet", level), 1))).toEqual(["●", "○", "■", "●", "○", "■", "●"]);
    expect(markerFor(item("bullet"), 5)).toBe("●");
  });

  it("numbers level 0 with 1. 2. 3.", () => {
    expect([1, 2, 3, 10, 123].map((n) => markerFor(item("number", 0), n))).toEqual(["1.", "2.", "3.", "10.", "123."]);
    expect(markerFor(item("number"), 2)).toBe("2.");
  });

  it("numbers level 1 with letters, counting on after z like spreadsheet columns", () => {
    expect([1, 2, 26, 27, 28, 52, 53, 702, 703].map((n) => markerFor(item("number", 1), n))).toEqual(["a.", "b.", "z.", "aa.", "ab.", "az.", "ba.", "zz.", "aaa."]);
  });

  it("numbers level 2 with Roman numerals", () => {
    expect([1, 2, 3, 4, 5, 9, 14, 40, 90, 400, 1994, 3999].map((n) => markerFor(item("number", 2), n))).toEqual([
      "i.", "ii.", "iii.", "iv.", "v.", "ix.", "xiv.", "xl.", "xc.", "cd.", "mcmxciv.", "mmmcmxcix.",
    ]);
    expect(markerFor(item("number", 2), 4000)).toBe("4000.");
  });

  it("repeats the cycle from level 3", () => {
    expect(markerFor(item("number", 3), 2)).toBe("2.");
    expect(markerFor(item("number", 4), 2)).toBe("b.");
    expect(markerFor(item("number", 5), 2)).toBe("ii.");
    expect(markerFor(item("number", 6), 3)).toBe("3.");
  });

  it("counts from 1 whatever it is given", () => {
    expect(markerFor(item("number", 0), 0)).toBe("1.");
    expect(markerFor(item("number", 0), -4)).toBe("1.");
    expect(markerFor(item("number", 0), 2.9)).toBe("2.");
    expect(markerFor(item("number", 0), Number.NaN)).toBe("1.");
  });

  it("has no marker for a paragraph that is not a list item", () => {
    expect(markerFor(item(null), 1)).toBe("");
  });

  it("writes each style as it is asked", () => {
    const text = (style: ListStyle, n: number) => markerText(style, n);
    expect(["disc", "circle", "square", "arrow", "check", "dash"].map((s) => text(s as ListStyle, 7))).toEqual(["●", "○", "■", "➢", "✓", "–"]);
    expect(text("decimal", 7)).toBe("7.");
    expect(text("decimalParen", 7)).toBe("7)");
    expect(text("lowerAlpha", 28)).toBe("ab.");
    expect(text("upperAlpha", 3)).toBe("C.");
    expect(text("lowerRoman", 9)).toBe("ix.");
    expect(text("upperRoman", 14)).toBe("XIV.");
  });

  it("takes a style of the kind of list the paragraph is, and the level's own otherwise", () => {
    expect(styleOf({ list: "bullet", level: 1, listStyle: "arrow" })).toBe("arrow");
    expect(styleOf({ list: "bullet", level: 1, listStyle: "decimal" })).toBe("circle");
    expect(styleOf({ list: "number", listStyle: "square" })).toBe("decimal");
    expect(styleOf({ list: null, listStyle: "arrow" })).toBeNull();
    expect(kindOfStyle("check")).toBe("bullet");
    expect(kindOfStyle("upperRoman")).toBe("number");
    expect(defaultStyle("number", 4)).toBe("lowerAlpha");
  });
});

describe("levelOf", () => {
  it("is a whole number from 0 to the ninth level", () => {
    expect(levelOf({})).toBe(0);
    expect(levelOf({ level: null })).toBe(0);
    expect(levelOf({ level: 3 })).toBe(3);
    expect(levelOf({ level: -2 })).toBe(0);
    expect(levelOf({ level: 1.7 })).toBe(1);
    expect(levelOf({ level: Number.NaN })).toBe(0);
    expect(levelOf({ level: 40 })).toBe(8);
  });
});

describe("listNumbers", () => {
  const numbers = (rows: [("bullet" | "number" | null), number?][]): (number | null)[] => listNumbers(rows.map(([list, level]) => item(list, level)));

  it("counts a run of numbered paragraphs", () => {
    expect(numbers([["number"], ["number"], ["number"]])).toEqual([1, 2, 3]);
  });

  it("gives plain paragraphs and bullets no number", () => {
    expect(numbers([[null], ["bullet"], ["number"]])).toEqual([null, null, 1]);
  });

  it("starts again after a plain paragraph", () => {
    expect(numbers([["number"], ["number"], [null], ["number"], ["number"]])).toEqual([1, 2, null, 1, 2]);
  });

  it("starts again after a bullet at the same level", () => {
    expect(numbers([["number"], ["number"], ["bullet"], ["number"]])).toEqual([1, 2, null, 1]);
  });

  it("is not interrupted by items nested deeper", () => {
    expect(numbers([["number", 0], ["number", 1], ["number", 1], ["number", 0], ["number", 1]])).toEqual([1, 1, 2, 2, 1]);
    expect(numbers([["number", 0], ["bullet", 1], ["number", 0]])).toEqual([1, null, 2]);
  });

  it("starts the inner count again under each outer item", () => {
    expect(numbers([["number", 0], ["number", 1], ["number", 1], ["number", 0], ["number", 1], ["number", 2], ["number", 2]])).toEqual([1, 1, 2, 2, 1, 1, 2]);
  });

  it("counts a list that starts deeper than level 0", () => {
    expect(numbers([["number", 2], ["number", 2], ["number", 0], ["number", 2]])).toEqual([1, 2, 1, 1]);
  });

  it("is empty for no paragraphs", () => {
    expect(listNumbers([])).toEqual([]);
  });

  it("begins a run of its own at the number an item names, and goes on from there", () => {
    const list = [item("number"), item("number"), { ...item("number"), start: 1 }, item("number")];
    expect(listNumbers(list)).toEqual([1, 2, 1, 2]);
    expect(listNumbers([{ ...item("number"), start: 5 }, item("number"), item(null), { ...item("number"), start: 3 }, item("number")])).toEqual([5, 6, null, 3, 4]);
  });

  it("counts each style on its own", () => {
    const styled = (listStyle: ListStyle): Paragraph => ({ ...item("number", 0), listStyle });
    expect(listNumbers([styled("decimal"), styled("decimal"), styled("upperAlpha"), styled("upperAlpha"), styled("decimal")])).toEqual([1, 2, 1, 2, 1]);
  });

  it("writes the markers of a whole text", () => {
    expect(markerTexts([item("bullet"), item("number"), item("number"), item(null), { ...item("number"), listStyle: "upperRoman" }])).toEqual(["●", "1.", "2.", null, "I."]);
  });
});

describe("where the lines of a paragraph start", () => {
  it("hangs a marker in the room it needs, and sits each level under the words of the one above", () => {
    const list = [item("number", 0), item("bullet", 1), item("bullet", 1), item(null)];
    const got = layoutParagraphs(list, [14, 14, 14, 14]);
    expect(got).toEqual([
      { margin: 24, indent: -24 },
      { margin: 48, indent: -24 },
      { margin: 48, indent: -24 },
      { margin: 0, indent: 0 },
    ]);
  });

  it("grows the room for a marker that needs it, the same for the whole level", () => {
    const list = Array.from({ length: 10 }, () => item("number", 0));
    expect(hangsByLevel(list, list.map(() => 14))[0]).toBe(36);
    expect(hangsByLevel([item("bullet")], [22])[0]).toBe(30);
    expect(hangsByLevel([item("bullet")], [400])[0]).toBe(240);
  });

  it("lets a paragraph place itself, and keeps the first line inside the box", () => {
    const own: Paragraph = { ...item("bullet", 0), marginLeft: 10, indent: -30 };
    expect(layoutParagraphs([own], [14])).toEqual([{ margin: 10, indent: -10 }]);
    expect(layoutParagraphs([{ ...item(null), marginLeft: 40, indent: 12 }], [14])).toEqual([{ margin: 40, indent: 12 }]);
  });

  it("works out a very long list in one pass", () => {
    const list = Array.from({ length: 30000 }, (_, n) => item("number", n % 3));
    const started = performance.now();
    expect(layoutParagraphs(list, list.map(() => 22))).toHaveLength(30000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("the cases the Rust side of the format is tested against", () => {
  interface Case {
    name: string;
    paragraphs: Paragraph[];
    points: number[];
    numbers: (number | null)[];
    markers: (string | null)[];
    margins: number[];
    indents: number[];
  }
  const cases: Case[] = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../fixtures/text/lists.json", import.meta.url)), "utf8")) as Case[];

  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(3);
  });

  for (const found of cases) {
    it(found.name, () => {
      expect(listNumbers(found.paragraphs)).toEqual(found.numbers);
      expect(markerTexts(found.paragraphs)).toEqual(found.markers);
      const geometry = layoutParagraphs(found.paragraphs, found.points);
      expect(geometry.map((g) => g.margin)).toEqual(found.margins);
      expect(geometry.map((g) => g.indent)).toEqual(found.indents);
    });
  }
});
