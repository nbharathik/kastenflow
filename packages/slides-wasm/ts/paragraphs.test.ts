import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { DeckEngine, type ParagraphLook, loadSlides } from "./index.ts";

beforeAll(async () => {
  await loadSlides(await readFile(new URL("../pkg/slides_wasm_bg.wasm", import.meta.url)));
});

/** What to set on paragraphs: the fields named, and nothing for the rest. */
const look = (set: Partial<ParagraphLook>): ParagraphLook => ({ list: null, listStyle: null, level: null, start: null, align: null, lineSpacing: null, spaceBefore: null, spaceAfter: null, marginLeft: null, indent: null, bulletColor: null, bulletSize: null, ...set });

describe("text and lists through the engine", () => {
  it("formats the paragraphs of a box without changing its words, and undoes it exactly", () => {
    const engine = DeckEngine.create("Talk", "Light", 31);
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    const box = { type: "text", x: 40, y: 40, w: 500, h: 200, text: { paragraphs: [{ runs: [{ t: "one" }] }, { runs: [{ t: "two" }] }] } };
    const id = engine.apply("add_elements", { slide, elements: [box as never] }).output.ids[0] ?? "";
    const before = engine.save();
    engine.apply("format_paragraphs", { slide, id, paragraphs: null, set: look({ list: "number", listStyle: "upperRoman", start: 4 }), clear: [] });
    const text = (engine.deck.slides.find((s) => s.id === slide)?.elements.find((e) => e.id === id) as { text: { paragraphs: { list?: string; listStyle?: string; start?: number }[] } }).text;
    expect(text.paragraphs.map((p) => [p.list, p.listStyle, p.start])).toEqual([
      ["number", "upperRoman", 4],
      ["number", "upperRoman", 4],
    ]);
    engine.undo();
    expect(engine.save()).toBe(before);
  });

  it("keeps what a box does with its words, the marker's look and the words' looks through a save", () => {
    const engine = DeckEngine.create("Talk", "Light", 32);
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    const box = {
      type: "text",
      x: 10,
      y: 10,
      w: 300,
      h: 100,
      text: {
        fit: "shrink",
        wrap: false,
        paragraphs: [{ list: "bullet", listStyle: "check", bulletColor: "accent2", bulletSize: 1.2, marginLeft: 40, indent: -20, runs: [{ t: "x", script: "sub", smallCaps: true, allCaps: true, spacing: -0.5 }] }],
      },
    };
    engine.apply("add_elements", { slide, elements: [box as never] });
    const saved = engine.save();
    const again = DeckEngine.open(saved, 1);
    expect(again.save()).toBe(saved);
    for (const word of ['"fit": "shrink"', '"wrap": false', '"listStyle": "check"', '"bulletColor": "accent2"', '"script": "sub"', '"smallCaps": true', '"spacing": -0.5']) expect(saved).toContain(word);
  });

  it("keeps the look an empty item has (its one empty run) and the share its marker is drawn at, through a save and a reload", () => {
    const engine = DeckEngine.create("Talk", "Light", 33);
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    const paragraphs = [
      { list: "bullet", bulletSize: 1.5, runs: [{ t: "How are you", size: 12 }] },
      { list: "bullet", bulletSize: 1.5, bulletColor: "accent2", runs: [{ t: "", size: 12, color: "accent2", b: true }] },
    ];
    const box = { type: "text", x: 10, y: 10, w: 300, h: 100, text: { paragraphs } };
    const id = engine.apply("add_elements", { slide, elements: [box as never] }).output.ids[0] ?? "";
    const saved = engine.save();
    const again = DeckEngine.open(saved, 1);
    expect(again.save()).toBe(saved);
    const text = (again.deck.slides.find((s) => s.id === slide)?.elements.find((e) => e.id === id) as { text: { paragraphs: unknown[] } }).text;
    expect(text.paragraphs).toEqual(paragraphs);
    // The marker's share is held to what PowerPoint can draw, 25% to 400%.
    expect(() => engine.apply("format_paragraphs", { slide, id, paragraphs: null, set: look({ bulletSize: 4.5 }), clear: [] })).toThrow();
    engine.apply("format_paragraphs", { slide, id, paragraphs: null, set: look({ bulletSize: 4 }), clear: [] });
    engine.undo();
    expect(engine.save()).toBe(saved);
  });
});
