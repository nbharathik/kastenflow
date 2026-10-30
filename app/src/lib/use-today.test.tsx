// The day that moves on by itself: at midnight, and when the window gets focus
// after a sleep.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { msToMidnight, useToday } from "./use-today";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 30));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useToday", () => {
  it("counts the milliseconds to the next midnight", () => {
    expect(msToMidnight(new Date(2026, 9, 29, 23, 59, 30))).toBe(30_000);
    expect(msToMidnight(new Date(2026, 9, 29, 0, 0, 0))).toBe(86_400_000);
  });

  it("turns to the next day when midnight passes", () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-10-29");
    act(() => void vi.advanceTimersByTime(29_000));
    expect(result.current).toBe("2026-10-29");
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current).toBe("2026-10-30");
  });

  it("looks again when the window gets focus, as a sleeping laptop misses timers", () => {
    const { result } = renderHook(() => useToday());
    vi.setSystemTime(new Date(2026, 9, 31, 8, 0));
    expect(result.current).toBe("2026-10-29");
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(result.current).toBe("2026-10-31");
  });
});
