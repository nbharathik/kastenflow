// A Calendar left open past midnight, or across a clock change, marks the new
// day as today without being reopened.

import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addDays } from "../../lib/dates";
import { announceWake } from "../../lib/wake";
import { openCalendar, today } from "./test-kit";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const marked = () => document.querySelector('[aria-current="date"]')?.getAttribute("aria-label") ?? document.querySelector('[aria-current="date"]')?.textContent ?? null;

describe("the Calendar and the clock", () => {
  it("marks the next day as today after midnight passes while it is open", async () => {
    await openCalendar({});
    const before = document.querySelector('[aria-current="date"]');
    expect(before).toBeTruthy();
    // Only the clock is replaced: the window keeps running on real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${addDays(today, 1)}T00:05:00`));
    act(() => void window.dispatchEvent(new Event("focus")));
    const after = document.querySelector('[aria-current="date"]');
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect(marked()).not.toBeNull();
  }, 60_000);

  it("follows the clock when the computer wakes after days asleep", async () => {
    await openCalendar({});
    const before = document.querySelector('[aria-current="date"]');
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${addDays(today, 2)}T09:00:00`));
    act(() => announceWake());
    expect(document.querySelector('[aria-current="date"]')).not.toBe(before);
  }, 60_000);
});
