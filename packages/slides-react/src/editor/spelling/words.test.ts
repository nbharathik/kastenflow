import type { Deck, Text } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { check, leaveAlone, occurrences, oneSlipApart, probableSlips, wordsIn } from "./words.ts";

const text = (...lines: string[]): Text => ({ paragraphs: lines.map((line) => ({ runs: [{ t: line }] })) }) as unknown as Text;
const box = (id: string, ...lines: string[]) => ({ type: "text", id, x: 0, y: 0, w: 10, h: 10, text: text(...lines) });
const deck = (...slides: { elements: unknown[]; notes?: string }[]): Deck =>
  ({ slides: slides.map((slide, i) => ({ id: `s${i + 1}`, layout: "blank", elements: slide.elements, notes: slide.notes ?? "" })) }) as unknown as Deck;

describe("the words of a text", () => {
  it("are letters with an apostrophe or hyphen inside, and figures and punctuation break them", () => {
    expect(wordsIn(text("Don’t over-think it, 2025 plans: ok?"))).toEqual(["Don’t", "over-think", "it", "plans", "ok"]);
  });

  it("leave out one-letter words, acronyms, words with a capital inside, code and formulas", () => {
    const mixed = { paragraphs: [{ runs: [{ t: "A NASA iPhone KastenFlow word " }, { t: "snippet", code: true }, { t: "alpha", math: true }, { t: "Fine" }] }] } as unknown as Text;
    expect(wordsIn(mixed)).toEqual(["word", "Fine"]);
    expect(leaveAlone("I")).toBe(true);
    expect(leaveAlone("Paris")).toBe(false);
  });
});

describe("the words of a deck", () => {
  it("come from boxes, shapes, tables, labels, groups and notes, each with where it is", () => {
    const d = deck(
      {
        elements: [
          box("a", "Hello world"),
          { type: "shape", id: "b", shape: "rect", text: text("inside") },
          { type: "table", id: "t", columns: [10], rows: [{ cells: [{ text: text("cell") }] }] },
          { type: "group", id: "g", children: [box("c", "nested")] },
        ],
      },
      { elements: [], notes: "spoken" },
    );
    const found = occurrences(d);
    expect([...found.keys()].sort()).toEqual(["Hello", "cell", "inside", "nested", "spoken", "world"]);
    expect(found.get("nested")).toEqual([{ slideId: "s1", elementId: "c", number: 1 }]);
    expect(found.get("spoken")).toEqual([{ slideId: "s2", elementId: null, number: 2 }]);
  });
});

describe("a slip of one letter", () => {
  it("is a letter changed, put in, left out, or two neighbours swapped", () => {
    expect(oneSlipApart("receive", "recieve")).toBe(true);
    expect(oneSlipApart("model", "modle")).toBe(true);
    expect(oneSlipApart("model", "modell")).toBe(true);
    expect(oneSlipApart("model", "mode")).toBe(true);
    expect(oneSlipApart("model", "motel")).toBe(true);
    expect(oneSlipApart("model", "moist")).toBe(false);
    expect(oneSlipApart("model", "model")).toBe(false);
    expect(oneSlipApart("model", "models and")).toBe(false);
  });

  it("is a probable slip when the word is written once and a common word is a slip away", () => {
    const slips = probableSlips(new Map([["model", 4], ["modle", 1], ["unique", 1], ["cat", 2], ["cot", 1]]));
    expect([...slips]).toEqual([["modle", "model"]]);
  });
});

describe("checking a deck", () => {
  const d = deck({ elements: [box("a", "The model and the model again"), box("b", "Zorblax rules the modle")] });

  it("lists the words the system's dictionary does not know, in the order the deck has them", async () => {
    const asked: string[][] = [];
    const found = await check(d, [], async (words) => {
      asked.push(words);
      return ["Zorblax", "modle"];
    });
    expect(found.map((f) => [f.word, f.reason, f.count])).toEqual([["Zorblax", "unknown", 1], ["modle", "unknown", 1]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
    expect(asked[0]).toContain("model");
  });

  it("never lists a word of the deck's own list, whatever its case", async () => {
    const found = await check(d, ["zorblax"], async () => ["Zorblax", "modle"]);
    expect(found.map((f) => f.word)).toEqual(["modle"]);
  });

  it("lists probable slips with the word they may have meant when there is no dictionary to ask", async () => {
    const found = await check(d, []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ word: "modle", reason: "probable slip", suggestion: "model", count: 1 });
  });
});
