import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { RehearsalRecord, RunComparison } from "./rehearsal.ts";
import { FAST_WPM, headline, paceOf, wordsIn } from "./rehearsal-pace.ts";
import { RehearsalSummary } from "./RehearsalSummary.tsx";

afterEach(cleanup);

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const slideOf = (id: string, notes?: string) => ({ id, layout: "blank", elements: [], steps: 0, ...(notes !== undefined ? { notes } : {}) });
const timing = (...times: [string, number][]): Pick<RehearsalRecord, "slides"> => ({ slides: times.map(([id, ms]) => ({ id, ms, visits: 1, steps: [] })) });

describe("counting words", () => {
  it("counts words, not marks", () => {
    expect(wordsIn(undefined)).toBe(0);
    expect(wordsIn("- one two\n\n**three** — four")).toBe(4);
    expect(wordsIn("# ---")).toBe(0);
  });
});

describe("a run against a target time", () => {
  it("shares the target out by how much there is to say, and calls slides over, under or on time", () => {
    const deck = { slides: [slideOf("a", words(60)), slideOf("b"), slideOf("c")] };
    // Weights 120, 60, 60: of 240 s, a has 120 s, b 60 s, c 60 s.
    const pace = paceOf(deck, { ...timing(["a", 200_000], ["b", 20_000], ["c", 62_000]), targetMs: 240_000 });
    expect(pace.fromTarget).toBe(true);
    expect(pace.rows.map((row) => [row.id, row.plannedMs, row.status])).toEqual([
      ["a", 120_000, "over"],
      ["b", 60_000, "under"],
      ["c", 60_000, "on"],
    ]);
    expect([pace.over, pace.under, pace.on]).toEqual([1, 1, 1]);
    expect(pace.plannedMs).toBe(240_000);
    expect(pace.deltaMs).toBe(80_000 - 40_000 + 2_000);
    expect(headline(pace)).toBe("1 slide ran over, 1 slide under, 1 on time.");
  });

  it("leaves out slides the run did not time, and keeps the deck's order", () => {
    const deck = { slides: [slideOf("a"), slideOf("skipped"), slideOf("b")] };
    const pace = paceOf(deck, { ...timing(["b", 30_000], ["a", 30_000]), targetMs: 60_000 });
    expect(pace.rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(pace.rows.every((row) => row.plannedMs === 30_000 && row.status === "on")).toBe(true);
    expect(headline(pace)).toBe("Every slide kept to its time (2 slides).");
  });
});

describe("a run with no target", () => {
  it("plans a slide from its notes at a steady pace, and gives none to a slide without notes", () => {
    const deck = { slides: [slideOf("a", words(130)), slideOf("b", words(3)), slideOf("c")] };
    const pace = paceOf(deck, timing(["a", 90_000], ["b", 10_000], ["c", 10_000]));
    expect(pace.fromTarget).toBe(false);
    const [a, b, c] = pace.rows;
    expect([a?.plannedMs, a?.status]).toEqual([60_000, "over"]);
    expect([b?.plannedMs, b?.status]).toEqual([undefined, undefined]);
    expect(c?.plannedMs).toBeUndefined();
    expect(pace.over + pace.under + pace.on).toBe(1);
  });

  it("says there was no plan when nothing can be compared", () => {
    const pace = paceOf({ slides: [slideOf("a")] }, timing(["a", 10_000]));
    expect(headline(pace)).toMatch(/no plan to compare/);
  });

  it("never plans a short note under twenty seconds", () => {
    const pace = paceOf({ slides: [slideOf("a", words(6))] }, timing(["a", 21_000]));
    expect(pace.rows[0]?.plannedMs).toBe(20_000);
    expect(pace.rows[0]?.status).toBe("on");
  });
});

describe("pace", () => {
  it("is the notes' words a minute, called fast, steady or slow, and only said when there is enough to say", () => {
    const deck = { slides: [slideOf("fast", words(100)), slideOf("steady", words(100)), slideOf("slow", words(100)), slideOf("short", words(10)), slideOf("brief", words(100))] };
    const pace = paceOf(deck, timing(["fast", 30_000], ["steady", 46_000], ["slow", 90_000], ["short", 30_000], ["brief", 3_000]));
    const tempo = Object.fromEntries(pace.rows.map((row) => [row.id, [row.wordsPerMinute, row.tempo]]));
    expect(tempo.fast).toEqual([200, "fast"]);
    expect(tempo.steady?.[1]).toBe("steady");
    expect(tempo.slow).toEqual([67, "slow"]);
    expect(tempo.short).toEqual([undefined, undefined]);
    expect(tempo.brief).toEqual([undefined, undefined]);
    expect(200).toBeGreaterThan(FAST_WPM);
  });
});

describe("the summary", () => {
  const deck = { slides: [slideOf("a", words(130)), slideOf("b", words(130))] };
  const record: RehearsalRecord = { deckId: "d", revision: "r", at: 0, totalMs: 160_000, slides: timing(["a", 100_000], ["b", 60_000]).slides };
  const comparison: RunComparison = { outdated: false, rows: [{ id: "a", title: "A", ms: 100_000 }, { id: "b", title: "B", ms: 60_000 }] };

  it("lists the slides that left the plan, with how far, under the table", () => {
    render(<RehearsalSummary deck={deck} record={record} comparison={comparison} inline />);
    const section = screen.getByRole("region", { name: "Against the plan" });
    expect(section.textContent).toContain("1 slide ran over, 1 on time.");
    const list = screen.getByRole("list", { name: "Slides that left the plan" });
    expect(list.textContent).toContain("Over by 0:40 (plan 1:00)");
    expect(list.textContent).not.toContain("2.");
  });

  it("says what the plan was made from", () => {
    render(<RehearsalSummary deck={deck} record={{ ...record, targetMs: 120_000 }} comparison={comparison} inline />);
    expect(screen.getByText(/Planned from the time aimed for/)).toBeTruthy();
  });
});
