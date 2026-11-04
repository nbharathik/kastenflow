import type { Deck, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { customShows, showDeck, slidesOfShow } from "./custom-show.ts";
import { planOf } from "./plan.ts";
import { plainDeck } from "../render/testing/decks.ts";

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deckWith = (shows: { id: string; name: string; slides: string[] }[], ...slides: Slide[]): Deck => {
  const base = plainDeck([]).deck;
  return { ...base, slides, present: { ...base.present, shows } };
};

describe("custom shows", () => {
  const deck = deckWith([{ id: "short", name: "Short", slides: ["c", "a"] }, { id: "gone", name: "Gone", slides: ["zz"] }], slide("a"), slide("b"), slide("c", { hidden: true }), slide("d", { backup: true }));

  it("are none for a deck that never made one", () => {
    const plain = plainDeck([]).deck;
    expect(customShows(plain)).toEqual([]);
    expect(showDeck(plain, "short")).toBe(plain);
  });

  it("play their slides in their own order, shown even if the deck hides them, and never as backups", () => {
    const shown = showDeck(deck, "short");
    expect(shown.slides.map((s) => s.id)).toEqual(["c", "a"]);
    expect(shown.slides.some((s) => s.hidden || s.backup)).toBe(false);
    const plan = planOf(shown);
    expect(plan.count).toBe(2);
    expect(plan.columns.map((column) => column.slides[0]?.id)).toEqual(["c", "a"]);
    // The deck itself is not touched.
    expect(deck.slides.find((s) => s.id === "c")?.hidden).toBe(true);
  });

  it("are the whole deck when no show is named, or the one named is not there or has nothing left", () => {
    expect(showDeck(deck, undefined)).toBe(deck);
    expect(showDeck(deck, null)).toBe(deck);
    expect(showDeck(deck, "missing")).toBe(deck);
    expect(showDeck(deck, "gone")).toBe(deck);
  });

  it("skip a slide the deck no longer has", () => {
    const show = { id: "s", name: "S", slides: ["a", "nope", "b"] };
    expect(slidesOfShow(deck, show).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
