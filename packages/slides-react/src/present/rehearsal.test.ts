import { describe, expect, it } from "vitest";

import { Rehearsal, compareRuns, recordOf, revisionOf } from "./rehearsal.ts";

const slideOf = (id: string, steps = 0) => ({ id, layout: "blank", elements: [], steps });
const deckOf = (...slides: ReturnType<typeof slideOf>[]) => ({ id: "d-1", slides });

describe("timing a rehearsal", () => {
  it("adds up the time on each slide and each step, from the moment it is visited to the next visit", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 1_000);
    run.visit("a", 1, 4_000);
    run.visit("b", 0, 9_000);
    const summary = run.summary(12_000);
    expect(summary.totalMs).toBe(11_000);
    expect(summary.slides).toEqual([
      { id: "a", ms: 8_000, visits: 1, steps: [{ step: 0, ms: 3_000 }, { step: 1, ms: 5_000 }] },
      { id: "b", ms: 3_000, visits: 1, steps: [{ step: 0, ms: 3_000 }] },
    ]);
  });

  it("does not count the time while it is paused, and goes on from the moment it is resumed", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 0);
    run.pause(2_000);
    expect(run.paused).toBe(true);
    // An hour goes by: a coffee.
    run.resume(3_602_000);
    run.visit("b", 0, 3_605_000);
    expect(run.summary(3_606_000).slides.map((s) => [s.id, s.ms])).toEqual([
      ["a", 5_000],
      ["b", 1_000],
    ]);
    expect(run.summary(3_606_000).totalMs).toBe(6_000);
  });

  it("does not count a pause twice, and a summary while paused stops at the pause", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 0);
    run.pause(1_000);
    run.pause(5_000);
    run.resume(10_000);
    run.resume(12_000);
    expect(run.summary(13_000).totalMs).toBe(4_000);
    const paused = new Rehearsal();
    paused.visit("a", 0, 0);
    paused.pause(1_000);
    expect(paused.summary(99_000).totalMs).toBe(1_000);
  });

  it("moves while paused without counting, and counts from the resume on the slide it moved to", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 0);
    run.pause(1_000);
    run.visit("b", 0, 2_000);
    run.resume(5_000);
    const summary = run.summary(7_000);
    expect(summary.slides.map((s) => [s.id, s.ms, s.visits])).toEqual([
      ["a", 1_000, 1],
      ["b", 2_000, 1],
    ]);
  });

  it("clears everything on a restart, and begins on the slide it is at when it is told", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 0);
    run.visit("b", 0, 5_000);
    run.pause(6_000);
    run.restart(10_000);
    expect(run.paused).toBe(false);
    expect(run.summary(20_000)).toEqual({ totalMs: 0, slides: [] });
    run.restart(30_000, { slide: "b", step: 2 });
    expect(run.summary(34_000)).toEqual({ totalMs: 4_000, slides: [{ id: "b", ms: 4_000, visits: 1, steps: [{ step: 2, ms: 4_000 }] }] });
  });

  it("adds up revisits to the same slide, and counts a step change as no new visit", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 0);
    run.visit("b", 0, 1_000);
    run.visit("a", 0, 3_000);
    run.visit("a", 1, 4_000);
    const summary = run.summary(10_000);
    const a = summary.slides.find((s) => s.id === "a");
    expect(a).toEqual({ id: "a", ms: 1_000 + 7_000, visits: 2, steps: [{ step: 0, ms: 2_000 }, { step: 1, ms: 6_000 }] });
    expect(summary.slides.map((s) => s.id)).toEqual(["a", "b"]);
    expect(summary.slides.find((s) => s.id === "b")?.ms).toBe(2_000);
  });

  it("counts nothing before the first visit, and never a negative time", () => {
    const run = new Rehearsal();
    expect(run.summary(5_000)).toEqual({ totalMs: 0, slides: [] });
    run.visit("a", 0, 10_000);
    run.visit("b", 0, 9_000);
    expect(run.summary(9_500).slides.map((s) => s.ms)).toEqual([0, 500]);
  });

  it("does not change what it was asked for when it summarises", () => {
    const run = new Rehearsal();
    run.visit("a", 0, 0);
    const first = run.summary(1_000);
    const again = run.summary(1_000);
    expect(again).toEqual(first);
    run.visit("a", 1, 2_000);
    expect(run.summary(2_000).totalMs).toBe(2_000);
  });
});

describe("the revision of a deck", () => {
  it("is the same for the same slides and steps, and changes when a slide or a step is added or removed", () => {
    const deck = deckOf(slideOf("a"), slideOf("b", 3));
    const revision = revisionOf(deck);
    expect(revision).toMatch(/^[0-9a-f]{16}$/);
    expect(revisionOf(deckOf(slideOf("a"), slideOf("b", 3)))).toBe(revision);
    expect(revisionOf(deckOf(slideOf("a"), slideOf("b", 4)))).not.toBe(revision);
    expect(revisionOf(deckOf(slideOf("a")))).not.toBe(revision);
    expect(revisionOf(deckOf(slideOf("b", 3), slideOf("a")))).not.toBe(revision);
    expect(revisionOf({ id: "d-2", slides: deck.slides })).not.toBe(revision);
  });

  it("is not changed by what is on a slide", () => {
    const plain = revisionOf(deckOf(slideOf("a")));
    const busy = revisionOf(deckOf({ ...slideOf("a"), elements: [{ id: "e", type: "text" } as never], notes: "words" } as never));
    expect(busy).toBe(plain);
  });
});

describe("a record and the one before it", () => {
  const deck = deckOf(slideOf("a"), slideOf("b"), slideOf("c"));
  const run = (visits: [string, number][]) => {
    const rehearsal = new Rehearsal();
    visits.forEach(([id, at]) => rehearsal.visit(id, 0, at));
    return recordOf(deck, rehearsal.summary(visits.length ? 100_000 : 0), 100_000);
  };

  it("keeps the deck, the revision, when it ended, and the time of each slide", () => {
    const record = run([["a", 0], ["b", 10_000]]);
    expect(record).toMatchObject({ deckId: "d-1", revision: revisionOf(deck), at: 100_000, totalMs: 100_000 });
    expect(record.slides.map((s) => [s.id, s.ms])).toEqual([
      ["a", 10_000],
      ["b", 90_000],
    ]);
  });

  it("compares each slide with the same slide of the last run of this revision", () => {
    const before = run([["a", 0], ["b", 20_000], ["c", 50_000]]);
    const now = run([["a", 0], ["b", 30_000], ["c", 60_000]]);
    const rows = compareRuns(now, before, deck);
    expect(rows.outdated).toBe(false);
    expect(rows.rows.map((r) => [r.id, r.ms, r.previousMs, r.deltaMs])).toEqual([
      ["a", 30_000, 20_000, 10_000],
      ["b", 30_000, 30_000, 0],
      ["c", 40_000, 50_000, -10_000],
    ]);
  });

  it("says the last run is outdated when the deck has changed since, and compares only the slides both have", () => {
    const before = run([["a", 0], ["b", 20_000]]);
    const changed = deckOf(slideOf("a"), slideOf("b", 2), slideOf("c"));
    const rehearsal = new Rehearsal();
    rehearsal.visit("a", 0, 0);
    rehearsal.visit("c", 0, 5_000);
    const now = recordOf(changed, rehearsal.summary(15_000), 15_000);
    const compared = compareRuns(now, before, changed);
    expect(compared.outdated).toBe(true);
    expect(compared.rows.find((r) => r.id === "a")?.previousMs).toBe(20_000);
    expect(compared.rows.find((r) => r.id === "c")?.previousMs).toBeUndefined();
  });

  it("is all new when there is no run before it", () => {
    const now = run([["a", 0]]);
    const compared = compareRuns(now, undefined, deck);
    expect(compared.outdated).toBe(false);
    expect(compared.rows.every((r) => r.previousMs === undefined && r.deltaMs === undefined)).toBe(true);
  });
});
