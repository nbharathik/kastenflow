// @vitest-environment node

import type { Deck, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { planOf } from "./plan.ts";
import { arrivalsOf, sectionAttributes } from "./section.ts";

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deckOf = (...slides: Slide[]): Deck => ({ ...plainDeck([]).deck, slides });

describe("what reveal.js is told about a slide", () => {
  const plan = planOf(deckOf(slide("a"), slide("b", { transition: { kind: "slide", duration: 0.5 } }), slide("c", { transition: { kind: "morph", duration: 0.9, easing: "ease-in-out" } }), slide("c2", { backup: true, transition: { kind: "morph" } })));
  const arrivals = arrivalsOf(plan);
  const of = (id: string) => {
    const found = plan.deck.slides.find((s) => s.id === id) as Slide;
    return sectionAttributes(found, arrivals.arrival(found), arrivals.run(found));
  };

  it("names the slide, how it arrives and how long that takes", () => {
    expect(of("a")).toEqual({ "data-slide": "a", "data-transition": "none", style: { transitionDuration: "0s" } });
    expect(of("b")).toMatchObject({ "data-slide": "b", "data-transition": "slide", style: { transitionDuration: "0.5s" } });
  });

  it("hands the kinds reveal.js has no name for to the runtime: reveal.js cuts, the attributes say how", () => {
    const own = planOf(deckOf(slide("a"), slide("p", { transition: { kind: "push", duration: 0.7, direction: "up" } }), slide("w", { transition: { kind: "wipe" } })));
    const pushing = arrivalsOf(own);
    const attrs = (id: string) => {
      const found = own.deck.slides.find((s) => s.id === id) as Slide;
      return sectionAttributes(found, pushing.arrival(found), undefined);
    };
    expect(attrs("p")).toMatchObject({ "data-transition": "none", "data-ks-fx": "push", "data-ks-dir": "up", "data-ks-seconds": "0.7", style: { transitionDuration: "0s" } });
    expect(attrs("w")).toMatchObject({ "data-ks-fx": "wipe", "data-ks-seconds": "0.5" });
    expect(attrs("w")["data-ks-dir"]).toBeUndefined();
    expect(attrs("p")["data-ks-fx"]).toBe("push");
  });

  it("makes a morph an auto-animate with the id of the run, its duration and its easing", () => {
    expect(of("c")).toMatchObject({ "data-transition": "fade", "data-auto-animate": "", "data-auto-animate-id": "morph-b", "data-auto-animate-duration": "0.9", "data-auto-animate-easing": "ease-in-out" });
    // The slide it morphs from is in the run.
    expect(of("b")).toMatchObject({ "data-auto-animate": "", "data-auto-animate-id": "morph-b" });
    // ... but the slide before it does not say how long: it is the later slide that does.
    expect(of("b")["data-auto-animate-duration"]).toBeUndefined();
  });

  it("never morphs a backup slide", () => {
    expect(of("c2")["data-auto-animate"]).toBeUndefined();
  });
});
