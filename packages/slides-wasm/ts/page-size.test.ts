// Page size, templates and what the engine keeps between edits: the typed side of `set_page_size`, `createWith`,
// the sharing of what did not change, and the cache of expansions.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { DeckEngine, builtInThemes, expandComposite, expansionCount, loadSlides, pageSizes } from "./index.ts";
import type { Element } from "./index.ts";

beforeAll(async () => {
  await loadSlides(await readFile(new URL("../pkg/slides_wasm_bg.wasm", import.meta.url)));
});

describe("page sizes", () => {
  it("are named by the engine, so no host keeps a list of its own", () => {
    expect(pageSizes()).toEqual([
      { name: "16:9", w: 960, h: 540 },
      { name: "16:10", w: 960, h: 600 },
      { name: "4:3", w: 960, h: 720 },
      { name: "1:1", w: 720, h: 720 },
    ]);
  });

  it("change the size of a deck and refit it as one step, which undo takes back to the byte", () => {
    const engine = DeckEngine.create("Talk", "Light", 1);
    engine.apply("add_slide", { layout: "title-body", content: { title: "Results", body: "- one" } });
    const before = engine.save();
    const applied = engine.apply("set_page_size", { preset: "4:3" });
    expect(applied.output).toEqual({ w: 960, h: 720 });
    expect(engine.deck.size).toMatchObject({ w: 960, h: 720 });
    // The theme was refitted with it, and what the engine reports is what the copy holds.
    const title = engine.deck.theme.layouts.find((l) => l.name === "title-body")!.placeholders[0]!;
    expect([title.y, title.h]).toEqual([48, 128]);
    expect(JSON.parse(engine.save()).size).toMatchObject({ w: 960, h: 720 });
    engine.undo();
    expect(engine.save()).toBe(before);
    expect(engine.deck.size).toMatchObject({ w: 960, h: 540 });
  });

  it("are refused with the reason, and the deck is left as it was", () => {
    const engine = DeckEngine.create("Talk", "Light", 2);
    const before = engine.save();
    expect(() => engine.apply("set_page_size", { w: 10, h: 540 })).toThrow(/between 96 and 5376/);
    expect(() => engine.apply("set_page_size", { preset: "5:4" })).toThrow(/16:9/);
    expect(engine.save()).toBe(before);
  });
});

describe("a new deck", () => {
  it("can be any size, with a theme's example slides", () => {
    const engine = DeckEngine.create("Quarterly review", "Pitch", 3, { size: { w: 960, h: 720 }, examples: true });
    expect(engine.deck.size).toMatchObject({ w: 960, h: 720 });
    expect(engine.deck.theme.name).toBe("Pitch");
    expect(engine.deck.slides.map((slide) => slide.layout)).toEqual(["title", "section", "title-body", "two-columns", "title-image", "quote", "title"]);
    expect(engine.canUndo).toBe(false);
    expect(DeckEngine.open(engine.save()).save()).toBe(engine.save());
  });

  it("is the deck create makes when no option is given", () => {
    expect(DeckEngine.create("T", "Light", 4, {}).save()).toBe(DeckEngine.create("T", "Light", 4).save());
  });

  it("is refused for a size that is not one", () => {
    expect(() => DeckEngine.create("T", "Light", 5, { size: { w: 20, h: 20 } })).toThrow(/between 96 and 5376/);
  });

  it("can be made in every built-in theme at every page size", () => {
    for (const theme of builtInThemes()) {
      for (const { w, h } of pageSizes()) {
        const engine = DeckEngine.create("A talk", theme, 6, { size: { w, h }, examples: true });
        expect(engine.deck.slides).toHaveLength(7);
        expect(engine.lintDeck().issues.filter((issue) => issue.severity === "error")).toEqual([]);
        engine.dispose();
      }
    }
  });
});

describe("a deck's own transition", () => {
  it("is set through set_present, and a transition of kind none takes it away", () => {
    const engine = DeckEngine.create("Talk", "Light", 7);
    engine.apply("set_present", { transition: { kind: "fade", duration: 0.5 } });
    expect(engine.deck.present.transition).toEqual({ kind: "fade", duration: 0.5 });
    engine.apply("set_present", { transition: { kind: "none" } });
    expect(engine.deck.present.transition ?? null).toBeNull();
  });
});

describe("what an edit leaves as it was", () => {
  const text = (id: string, x: number): Element => ({ type: "text", id, x, y: 100, w: 200, h: 40, text: { paragraphs: [{ runs: [{ t: id }] }] } }) as Element;

  it("is every element of the slide that did not change, the very object it was", () => {
    const engine = DeckEngine.create("Talk", "Light", 8);
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    engine.apply("add_elements", { slide, elements: [text("a", 10), text("b", 300)] });
    const before = engine.deck.slides[1]!;
    engine.apply("transform_elements", { slide, items: [{ id: "b", x: 400 }] });
    const after = engine.deck.slides[1]!;
    expect(after).not.toBe(before);
    expect(after.elements[0]).toBe(before.elements[0]);
    expect(after.elements[1]).not.toBe(before.elements[1]);
    // Undo brings the old b back as content; the untouched a is still the same object.
    engine.undo();
    expect(engine.deck.slides[1]!.elements[0]).toBe(before.elements[0]);
    expect(engine.deck.slides[1]).toEqual(before);
  });

  it("is what a group holds that did not change, too", () => {
    const engine = DeckEngine.create("Talk", "Light", 9);
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    engine.apply("add_elements", { slide, elements: [text("a", 10), text("b", 300)] });
    engine.apply("group_elements", { slide, ids: ["a", "b"] });
    const before = engine.deck.slides[1]!.elements[0]!;
    engine.apply("transform_elements", { slide, items: [{ id: "b", x: 500 }] });
    const after = engine.deck.slides[1]!.elements[0]!;
    expect(after).not.toBe(before);
    if (before.type !== "group" || after.type !== "group") throw new Error("a group");
    expect(after.children[0]).toBe(before.children[0]);
    expect(after.children[1]).not.toBe(before.children[1]);
  });
});

describe("the expansion of a composite", () => {
  const code = { type: "code", id: "c", language: "python", code: "print(1)", x: 64, y: 160, w: 500, h: 240 } as Element;

  it("is kept for a new object with the same content, and made again for other content or another theme", () => {
    const engine = DeckEngine.create("Talk", "Light", 10);
    const theme = engine.deck.theme;
    const first = expandComposite(theme, "blank", code);
    const made = expansionCount();
    expect(expandComposite(theme, "blank", { ...code })).toBe(first);
    expect(expandComposite(theme, "blank", structuredClone(code))).toBe(first);
    expect(expansionCount()).toBe(made);
    expect(expandComposite(theme, "blank", { ...code, w: 501 } as Element)).not.toBe(first);
    expect(expansionCount()).toBe(made + 1);
    expect(expandComposite(DeckEngine.create("Talk", "Dark", 11).deck.theme, "blank", code)).not.toBe(first);
    expect(expansionCount()).toBe(made + 2);
  });

  it("is the same group whichever element object asked", () => {
    const theme = DeckEngine.create("Talk", "Serif", 12).deck.theme;
    const a = expandComposite(theme, "blank", { ...code, id: "x" } as Element);
    const b = expandComposite(theme, "blank", { ...code, id: "y" } as Element);
    // Ids are part of what is expanded, so different ids are different expansions.
    expect(a).not.toBe(b);
    expect(a && (a as { id: string }).id).toBe("x");
    expect(b && (b as { id: string }).id).toBe("y");
  });
});
