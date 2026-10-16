// A view that watches some kinds of file is drawn again when one of those
// counters moves, and not when only another kind does.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NO_REVISION, applyRevision, resetRevision, useStamp } from "./revision";

const at = (over: Partial<typeof NO_REVISION>) => ({ ...NO_REVISION, epoch: 3, ...over });

afterEach(() => {
  resetRevision();
  cleanup();
});

describe("useStamp", () => {
  it("changes with the areas it names and stays put for the others", () => {
    applyRevision(at({ all: 1, notes: 1 }));
    let draws = 0;
    const { result } = renderHook(() => {
      draws++;
      return useStamp("boards", "decks");
    });
    const first = result.current;
    const drawn = draws;
    act(() => applyRevision(at({ all: 2, notes: 2 })));
    expect(result.current).toBe(first);
    expect(draws).toBe(drawn);
    act(() => applyRevision(at({ all: 3, notes: 2, boards: 1 })));
    expect(result.current).not.toBe(first);
    expect(draws).toBeGreaterThan(drawn);
    const second = result.current;
    act(() => applyRevision(at({ all: 4, notes: 2, boards: 1, decks: 1 })));
    expect(result.current).not.toBe(second);
  });

  it("starts over when the vault is opened again", () => {
    applyRevision(at({ all: 9, boards: 9 }));
    const { result } = renderHook(() => useStamp("boards"));
    const before = result.current;
    act(() => applyRevision({ ...at({ all: 0, boards: 9 }), epoch: 4 }));
    expect(result.current).not.toBe(before);
  });
});
