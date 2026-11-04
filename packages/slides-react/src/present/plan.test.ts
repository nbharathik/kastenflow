// @vitest-environment node

import type { Deck, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { arrivalOf, clampPosition, fromState, hasBackups, morphRuns, move, planOf, positionOf, samePosition, spotAt, startPosition, stepFor, toState } from "./plan.ts";

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });

function deckOf(...slides: Slide[]): Deck {
  return { ...plainDeck([]).deck, slides };
}

const ids = (deck: Deck): string[][] => planOf(deck).columns.map((column) => column.slides.map((s) => s.id));

describe("the columns of a deck", () => {
  it("is one column for each slide that is shown", () => {
    expect(ids(deckOf(slide("a"), slide("b"), slide("c")))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("leaves hidden slides out", () => {
    expect(ids(deckOf(slide("a"), slide("b", { hidden: true }), slide("c")))).toEqual([["a"], ["c"]]);
  });

  it("stacks a backup slide under the slide above it", () => {
    expect(ids(deckOf(slide("a"), slide("a2", { backup: true }), slide("a3", { backup: true }), slide("b")))).toEqual([["a", "a2", "a3"], ["b"]]);
  });

  it("leaves out the backups of a hidden slide, which nobody could reach, and keeps those of a slide before it", () => {
    const deck = deckOf(slide("a"), slide("a2", { backup: true }), slide("b", { hidden: true }), slide("b2", { backup: true }), slide("c"), slide("c2", { backup: true }));
    expect(ids(deck)).toEqual([["a", "a2"], ["c", "c2"]]);
  });

  it("skips a hidden backup and keeps the ones after it", () => {
    expect(ids(deckOf(slide("a"), slide("a2", { backup: true, hidden: true }), slide("a3", { backup: true })))).toEqual([["a", "a3"]]);
  });

  it("makes a slide of a backup that has no slide above it", () => {
    expect(ids(deckOf(slide("x", { backup: true }), slide("a")))).toEqual([["x"], ["a"]]);
  });

  it("numbers the slides that are shown, backups included, from 1", () => {
    const plan = planOf(deckOf(slide("a"), slide("h", { hidden: true }), slide("b"), slide("b2", { backup: true })));
    expect([...plan.numbers]).toEqual([
      ["a", 1],
      ["b", 2],
      ["b2", 3],
    ]);
    expect(plan.count).toBe(3);
  });

  it("knows whether there are backups", () => {
    expect(hasBackups(planOf(deckOf(slide("a"), slide("b"))))).toBe(false);
    expect(hasBackups(planOf(deckOf(slide("a"), slide("b", { backup: true }))))).toBe(true);
  });
});

describe("positions", () => {
  const deck = deckOf(slide("a", { steps: 2 }), slide("a2", { backup: true, steps: 1 }), slide("b"), slide("h", { hidden: true }), slide("c", { steps: 3 }));
  const plan = planOf(deck);

  it("finds a slide by id at a step", () => {
    expect(positionOf(plan, "a")).toEqual({ h: 0, v: 0, f: -1 });
    expect(positionOf(plan, "a", 2)).toEqual({ h: 0, v: 0, f: 1 });
    expect(positionOf(plan, "a2")).toEqual({ h: 0, v: 1, f: -1 });
    expect(positionOf(plan, "c", 9)).toEqual({ h: 2, v: 0, f: 2 });
    expect(positionOf(plan, "h")).toBeNull();
    expect(positionOf(plan, "nope")).toBeNull();
  });

  it("begins at the slide asked for, or the next one shown when that one is skipped", () => {
    expect(startPosition(plan, 0)).toEqual({ h: 0, v: 0, f: -1 });
    expect(startPosition(plan, 1)).toEqual({ h: 0, v: 1, f: -1 });
    expect(startPosition(plan, 2)).toEqual({ h: 1, v: 0, f: -1 });
    expect(startPosition(plan, 3)).toEqual({ h: 2, v: 0, f: -1 });
    expect(startPosition(plan, 99)).toEqual({ h: 2, v: 0, f: -1 });
    expect(startPosition(plan, -4)).toEqual({ h: 0, v: 0, f: -1 });
  });

  it("begins at the last slide when everything after the one asked for is hidden", () => {
    const tail = planOf(deckOf(slide("a"), slide("b"), slide("c", { hidden: true })));
    expect(startPosition(tail, 2)).toEqual({ h: 1, v: 0, f: -1 });
  });

  it("keeps a position inside the plan", () => {
    expect(clampPosition(plan, { h: 9, v: 9, f: 9 })).toEqual({ h: 2, v: 0, f: 2 });
    expect(clampPosition(plan, { h: -1, v: -1, f: -5 })).toEqual({ h: 0, v: 0, f: -1 });
    expect(clampPosition(plan, { h: 0, v: 1, f: 4 })).toEqual({ h: 0, v: 1, f: 0 });
    expect(clampPosition(plan, { h: Number.NaN, v: 0, f: Number.NaN })).toEqual({ h: 0, v: 0, f: -1 });
  });

  it("says what is showing: the slide, and how many of its steps", () => {
    expect(spotAt(plan, { h: 0, v: 0, f: -1 })).toMatchObject({ step: 0, steps: 2, slide: { id: "a" } });
    expect(spotAt(plan, { h: 0, v: 0, f: 1 })).toMatchObject({ step: 2, steps: 2 });
    expect(spotAt(plan, { h: 1, v: 0, f: -1 })).toMatchObject({ step: 0, steps: 0, slide: { id: "b" } });
    expect(spotAt(planOf(deckOf()), { h: 0, v: 0, f: -1 })).toBeNull();
  });

  it("goes to and from reveal.js's state; a slide without steps has no fragment index", () => {
    expect(toState(plan, { h: 0, v: 0, f: 0 })).toEqual({ indexh: 0, indexv: 0, indexf: 0 });
    expect(toState(plan, { h: 1, v: 0, f: -1 })).toEqual({ indexh: 1, indexv: 0 });
    expect(fromState(plan, { indexh: 2, indexv: 0, indexf: 1 })).toEqual({ h: 2, v: 0, f: 1 });
    expect(fromState(plan, { indexh: 1, indexv: 0, indexf: undefined })).toEqual({ h: 1, v: 0, f: -1 });
    expect(fromState(plan, { indexh: 7, indexv: 3, indexf: 8 })).toEqual({ h: 2, v: 0, f: 2 });
  });

  it("draws a slide at the step it is at, done when behind and not begun when ahead", () => {
    const at = { h: 1, v: 0, f: -1 };
    expect(stepFor(plan, at, 0, 0)).toBe(2);
    expect(stepFor(plan, at, 0, 1)).toBe(1);
    expect(stepFor(plan, at, 1, 0)).toBe(0);
    expect(stepFor(plan, at, 2, 0)).toBe(0);
    expect(stepFor(plan, { h: 2, v: 0, f: 1 }, 2, 0)).toBe(2);
    expect(stepFor(plan, { h: 0, v: 1, f: -1 }, 0, 0)).toBe(2);
    expect(stepFor(plan, { h: 0, v: 1, f: -1 }, 0, 1)).toBe(0);
    expect(stepFor(plan, at, 9, 9)).toBe(0);
  });
});

describe("moving", () => {
  const plan = planOf(deckOf(slide("a", { steps: 2 }), slide("a2", { backup: true, steps: 1 }), slide("a3", { backup: true }), slide("b"), slide("c", { steps: 1 })));
  const walk = (from: { h: number; v: number; f: number }, ...directions: Parameters<typeof move>[2][]) => directions.reduce((at, direction) => move(plan, at, direction), from);

  it("goes right through the steps of a slide, then on to the next slide at its start", () => {
    expect(walk({ h: 0, v: 0, f: -1 }, "right")).toEqual({ h: 0, v: 0, f: 0 });
    expect(walk({ h: 0, v: 0, f: -1 }, "right", "right")).toEqual({ h: 0, v: 0, f: 1 });
    expect(walk({ h: 0, v: 0, f: -1 }, "right", "right", "right")).toEqual({ h: 1, v: 0, f: -1 });
  });

  it("goes left through the steps back, then to the slide before as it ended", () => {
    expect(walk({ h: 0, v: 0, f: 1 }, "left")).toEqual({ h: 0, v: 0, f: 0 });
    expect(walk({ h: 0, v: 0, f: 0 }, "left", "left")).toEqual({ h: 0, v: 0, f: -1 });
    expect(walk({ h: 2, v: 0, f: -1 }, "left")).toEqual({ h: 1, v: 0, f: -1 });
    expect(walk({ h: 1, v: 0, f: -1 }, "left")).toEqual({ h: 0, v: 0, f: 1 });
  });

  it("stops at the ends", () => {
    expect(walk({ h: 0, v: 0, f: -1 }, "left")).toEqual({ h: 0, v: 0, f: -1 });
    expect(walk({ h: 2, v: 0, f: 0 }, "right")).toEqual({ h: 2, v: 0, f: 0 });
    expect(walk({ h: 0, v: 0, f: -1 }, "up")).toEqual({ h: 0, v: 0, f: -1 });
    expect(walk({ h: 1, v: 0, f: -1 }, "down")).toEqual({ h: 1, v: 0, f: -1 });
  });

  it("goes down and up through the backups without going through steps, and lands on a backup as it begins", () => {
    expect(walk({ h: 0, v: 0, f: -1 }, "down")).toEqual({ h: 0, v: 1, f: -1 });
    expect(walk({ h: 0, v: 0, f: 0 }, "down", "down")).toEqual({ h: 0, v: 2, f: -1 });
    expect(walk({ h: 0, v: 2, f: -1 }, "down")).toEqual({ h: 0, v: 2, f: -1 });
  });

  it("goes up to the slide above as it ended", () => {
    expect(walk({ h: 0, v: 1, f: -1 }, "up")).toEqual({ h: 0, v: 0, f: 1 });
    expect(walk({ h: 0, v: 2, f: -1 }, "up")).toEqual({ h: 0, v: 1, f: 0 });
  });

  it("goes along the row to the slide at the top of a column, never to a backup", () => {
    expect(walk({ h: 0, v: 2, f: -1 }, "right")).toEqual({ h: 1, v: 0, f: -1 });
    expect(walk({ h: 1, v: 0, f: -1 }, "left", "down")).toEqual({ h: 0, v: 1, f: -1 });
    expect(walk({ h: 0, v: 1, f: 0 }, "left")).toEqual({ h: 0, v: 1, f: -1 });
    expect(walk({ h: 0, v: 1, f: -1 }, "left")).toEqual({ h: 0, v: 1, f: -1 });
  });

  it("agrees with itself: the same position, whichever way it is come to", () => {
    const there = walk({ h: 0, v: 0, f: -1 }, "right", "right", "right", "right");
    expect(samePosition(there, { h: 2, v: 0, f: -1 })).toBe(true);
  });
});

describe("how a slide arrives", () => {
  const deck = deckOf(slide("a"), slide("b", { transition: { kind: "fade" } }), slide("c", { transition: { kind: "morph", duration: 1.5, easing: "ease-in-out" } }), slide("d"));

  it("is what the slide says, else the deck's, else nothing", () => {
    const [a, b, c] = deck.slides as [Slide, Slide, Slide];
    expect(arrivalOf(deck, a)).toEqual({ kind: "none", duration: 0, easing: null, direction: null });
    expect(arrivalOf(deck, b)).toEqual({ kind: "fade", duration: 0.4, easing: null, direction: null });
    expect(arrivalOf(deck, c)).toEqual({ kind: "morph", duration: 1.5, easing: "ease-in-out", direction: null });
    const withDefault = { ...deck, present: { ...deck.present, transition: { kind: "slide" as const } } };
    expect(arrivalOf(withDefault, a)).toEqual({ kind: "slide", duration: 0.4, easing: null, direction: null });
    expect(arrivalOf(withDefault, b).kind).toBe("fade");
  });

  it("keeps the side a new kind comes from and has a time for each kind", () => {
    const pushed = deckOf(slide("a", { transition: { kind: "push", direction: "left" } }), slide("b", { transition: { kind: "cover" } }));
    expect(arrivalOf(pushed, pushed.slides[0] as Slide)).toEqual({ kind: "push", duration: 0.5, easing: null, direction: "left" });
    expect(arrivalOf(pushed, pushed.slides[1] as Slide).direction).toBeNull();
  });

  it("takes 0.6 seconds to morph when the slide does not say", () => {
    const plain = deckOf(slide("a"), slide("m", { transition: { kind: "morph" } }));
    expect(arrivalOf(plain, plain.slides[1] as Slide).duration).toBe(0.6);
  });

  it("gives one id to a run of slides that each morph from the one before, and none to a slide that does not", () => {
    const morph = { transition: { kind: "morph" as const } };
    const plan = planOf(deckOf(slide("a"), slide("b", morph), slide("c", morph), slide("d"), slide("e", morph), slide("f")));
    const runs = morphRuns(plan);
    expect(runs.get("a")).toBe("morph-a");
    expect(runs.get("b")).toBe("morph-a");
    expect(runs.get("c")).toBe("morph-a");
    expect(runs.has("d")).toBe(true);
    expect(runs.get("d")).toBe("morph-d");
    expect(runs.get("e")).toBe("morph-d");
    expect(runs.has("f")).toBe(false);
  });

  it("does not morph the first slide", () => {
    expect(morphRuns(planOf(deckOf(slide("a", { transition: { kind: "morph" } }), slide("b")))).size).toBe(0);
  });
});
