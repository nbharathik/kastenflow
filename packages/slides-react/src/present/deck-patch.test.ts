import type { Deck, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { PatchMaker, applyPatch } from "./deck-patch.ts";
import { plainDeck } from "../render/testing/decks.ts";

const slide = (id: string, notes = ""): Slide => ({ id, layout: "blank", elements: [], ...(notes ? { notes } : {}) });
const deckOf = (...slides: Slide[]): Deck => ({ ...plainDeck([]).deck, slides });
const images = { "assets/a.png": "blob:a" };

describe("what the presenter's window is sent when the deck is edited", () => {
  it("is nothing when nothing changed, even if the deck is a new object with the same words", () => {
    const maker = new PatchMaker();
    const deck = deckOf(slide("a"), slide("b"));
    maker.reset(deck, images);
    expect(maker.make(structuredClone(deck), { ...images })).toBeNull();
  });

  it("is only the slide that changed, and the order", () => {
    const maker = new PatchMaker();
    const before = deckOf(slide("a"), slide("b"), slide("c"));
    maker.reset(before, images);
    const patch = maker.make(deckOf(slide("a"), slide("b", "new notes"), slide("c")), images);
    expect(patch?.slides.map((s) => s.id)).toEqual(["b"]);
    expect(patch?.order).toEqual(["a", "b", "c"]);
    expect(patch?.head).toBeUndefined();
    expect(patch?.images).toBeUndefined();
  });

  it("is a new slide whole, and a reorder with no slide at all", () => {
    const maker = new PatchMaker();
    maker.reset(deckOf(slide("a"), slide("b")), images);
    expect(maker.make(deckOf(slide("a"), slide("n"), slide("b")), images)?.slides.map((s) => s.id)).toEqual(["n"]);
    const moved = maker.make(deckOf(slide("b"), slide("a"), slide("n")), images);
    expect(moved?.slides).toEqual([]);
    expect(moved?.order).toEqual(["b", "a", "n"]);
  });

  it("carries the rest of the deck, or the pictures, only when they changed", () => {
    const maker = new PatchMaker();
    const deck = deckOf(slide("a"));
    maker.reset(deck, images);
    const titled = maker.make({ ...deck, title: "Renamed" }, images);
    expect(titled?.head?.title).toBe("Renamed");
    expect(titled?.slides).toEqual([]);
    const pictured = maker.make({ ...deck, title: "Renamed" }, { ...images, "assets/b.png": "blob:b" });
    expect(pictured?.images).toEqual({ "assets/a.png": "blob:a", "assets/b.png": "blob:b" });
    expect(pictured?.head).toBeUndefined();
  });

  it("is made once: the same edit again is nothing", () => {
    const maker = new PatchMaker();
    maker.reset(deckOf(slide("a")), images);
    const next = deckOf(slide("a", "x"));
    expect(maker.make(next, images)).not.toBeNull();
    expect(maker.make(next, images)).toBeNull();
  });
});

describe("a patch applied", () => {
  it("gives the deck the edit made, keeping the slides that did not change as they were", () => {
    const maker = new PatchMaker();
    const before = deckOf(slide("a"), slide("b"));
    maker.reset(before, images);
    const after = { ...deckOf(slide("b", "edited"), slide("a"), slide("n")), title: "T" };
    const patch = maker.make(after, images);
    const applied = applyPatch(before, patch!);
    expect(applied).toEqual(after);
    expect(applied?.slides[1]).toBe(before.slides[0]);
  });

  it("is refused when it names a slide the window never had and does not carry", () => {
    expect(applyPatch(deckOf(slide("a")), { order: ["a", "x"], slides: [] })).toBeNull();
  });
});
