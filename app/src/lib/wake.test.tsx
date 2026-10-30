// Sleep and resume, and the clock being set: the beat notices, polls start
// over, the day moves on, a start-up time is not carried over to a later
// connection, and what changed while the laptop slept is read.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { startLive } from "../features/workspace/status";
import { useWorkspace } from "../features/workspace/store";
import { startupMarks } from "./startup-timing";
import { startInterval } from "./use-interval";
import { useToday } from "./use-today";
import { announceWake, BEAT_MS, GAP_MS, onWake, watchWake } from "./wake";

function hide(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 29, 22, 0, 0));
});
afterEach(() => {
  cleanup();
  hide(false);
  vi.useRealTimers();
});

describe("the wake beat", () => {
  it("stays quiet while time passes evenly", () => {
    const woke = vi.fn();
    const off = onWake(woke);
    const stop = watchWake();
    vi.advanceTimersByTime(BEAT_MS * 20);
    expect(woke).not.toHaveBeenCalled();
    stop();
    off();
  });

  it("tells that the computer slept: a gap far longer than the beat", () => {
    const woke = vi.fn();
    const off = onWake(woke);
    const stop = watchWake();
    vi.advanceTimersByTime(BEAT_MS * 2);
    // The laptop sleeps for six hours: no timer ran, the clock moved on.
    vi.setSystemTime(Date.now() + 6 * 3_600_000);
    vi.advanceTimersByTime(BEAT_MS);
    expect(woke).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BEAT_MS * 3);
    expect(woke).toHaveBeenCalledTimes(1);
    stop();
    off();
  });

  it("tells that the clock was set back, or forward by an hour (daylight saving)", () => {
    const woke = vi.fn();
    const off = onWake(woke);
    const stop = watchWake();
    vi.setSystemTime(Date.now() - 3_600_000);
    vi.advanceTimersByTime(BEAT_MS);
    expect(woke).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 3_600_000);
    vi.advanceTimersByTime(BEAT_MS);
    expect(woke).toHaveBeenCalledTimes(2);
    stop();
    off();
  });

  it("ignores a small drift (a busy window running a timer a little late)", () => {
    const woke = vi.fn();
    const off = onWake(woke);
    const stop = watchWake();
    vi.setSystemTime(Date.now() + GAP_MS - 1000);
    vi.advanceTimersByTime(BEAT_MS);
    expect(woke).not.toHaveBeenCalled();
    stop();
    off();
  });
});

describe("polls after a wake", () => {
  it("run at once and keep a full period after it", () => {
    const run = vi.fn();
    const stop = startInterval(run, 60_000);
    vi.advanceTimersByTime(45_000);
    act(() => announceWake());
    expect(run).toHaveBeenCalledTimes(1);
    // The beat started over: 45 s later is not yet a period from the wake.
    vi.advanceTimersByTime(45_000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("do not run for a wake while the window is hidden; they run when it is shown", () => {
    const run = vi.fn();
    const stop = startInterval(run, 60_000);
    hide(true);
    act(() => announceWake());
    expect(run).not.toHaveBeenCalled();
    hide(false);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stop listening when stopped", () => {
    const run = vi.fn();
    startInterval(run, 60_000)();
    act(() => announceWake());
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the day after a sleep or a clock change", () => {
  it("moves on at a wake even when the window got no focus event", () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-10-29");
    vi.setSystemTime(new Date(2026, 9, 31, 7, 30));
    act(() => announceWake());
    expect(result.current).toBe("2026-10-31");
  });

  it("goes back when the clock is set back over midnight", () => {
    vi.setSystemTime(new Date(2026, 9, 30, 0, 20));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-10-30");
    vi.setSystemTime(new Date(2026, 9, 29, 23, 20));
    act(() => announceWake());
    expect(result.current).toBe("2026-10-29");
  });

  it("still turns at the next midnight after the clock was set", () => {
    const { result } = renderHook(() => useToday());
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 40));
    act(() => announceWake());
    act(() => void vi.advanceTimersByTime(21_000));
    expect(result.current).toBe("2026-10-30");
  });
});

describe("what changed while the laptop slept", () => {
  it("is read when the computer wakes, without any watcher event", async () => {
    vi.useRealTimers();
    const vault = new MemoryVault({ "library/plan.md": "---\ntitle: Plan\n---\nBody\n" });
    await useWorkspace.getState().connect({ client: vault });
    const stop = startLive(vault);
    expect(useWorkspace.getState().notes.map((n) => n.title)).not.toContain("Made while asleep");
    // Made by another computer or a sync while this one slept: the window was told nothing.
    await vault.create({ kind: "page", title: "Made while asleep", date: "2026-10-29" });
    expect(useWorkspace.getState().notes.map((n) => n.title)).not.toContain("Made while asleep");
    act(() => announceWake());
    await vi.waitFor(() => expect(useWorkspace.getState().notes.map((n) => n.title)).toContain("Made while asleep"));
    stop();
  });
});

describe("start-up marks", () => {
  it("belong to the latest connection, not an earlier one", async () => {
    vi.useRealTimers();
    const marks: { name: string; startTime: number }[] = [];
    let clock = 100;
    const real = { mark: performance.mark, clear: performance.clearMarks, entries: performance.getEntriesByType };
    performance.mark = ((name: string) => void marks.push({ name, startTime: (clock += 50) })) as never;
    performance.clearMarks = ((name?: string) => {
      for (let i = marks.length - 1; i >= 0; i--) if (!name || marks[i]!.name === name) marks.splice(i, 1);
    }) as never;
    performance.getEntriesByType = (() => marks) as never;
    try {
      await useWorkspace.getState().connect({ client: new MemoryVault({}) });
      await useWorkspace.getState().connect({ client: new MemoryVault({}) });
      const names = startupMarks().map((m) => m.name);
      expect(names.filter((n) => n === "connected")).toHaveLength(1);
      expect(names.filter((n) => n === "listed")).toHaveLength(1);
      // The one kept is the second connection's: later than the first pair.
      expect(startupMarks().find((m) => m.name === "connected")!.at).toBeGreaterThan(200);
    } finally {
      performance.mark = real.mark;
      performance.clearMarks = real.clear;
      performance.getEntriesByType = real.entries;
    }
  });
});
