import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardController } from "./controller";
import { GRACE_MS, heldBoards, leaseBoard, rekeyBoard } from "./registry";

const fake = (path: string) => ({ path }) as unknown as BoardController;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  rekeyBoard("a.canvas");
  rekeyBoard("b.canvas");
  vi.useRealTimers();
});

describe("the board registry", () => {
  it("gives a tab and an embed of the same path the same controller, across a remount", async () => {
    const load = vi.fn(async () => fake("a.canvas"));
    const tab = leaseBoard("a.canvas", load);
    const embed = leaseBoard("a.canvas", load);
    expect(await tab.board).toBe(await embed.board);
    tab.release();
    vi.advanceTimersByTime(GRACE_MS * 2);
    expect(heldBoards(), "the embed still holds it").toBe(1);
    embed.release();
    const again = leaseBoard("a.canvas", load);
    expect(await again.board).toBe(await embed.board);
    expect(load).toHaveBeenCalledTimes(1);
    again.release();
  });

  it("releases a controller after the grace period, and not before", async () => {
    const load = vi.fn(async () => fake("a.canvas"));
    const lease = leaseBoard("a.canvas", load);
    await lease.board;
    lease.release();
    lease.release();
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(heldBoards()).toBe(1);
    vi.advanceTimersByTime(2);
    expect(heldBoards()).toBe(0);
  });

  it("does not mix two boards, and a renamed board starts clean", async () => {
    const a = leaseBoard("a.canvas", async () => fake("a.canvas"));
    const b = leaseBoard("b.canvas", async () => fake("b.canvas"));
    expect(await a.board).not.toBe(await b.board);
    rekeyBoard("a.canvas");
    const fresh = leaseBoard("a.canvas", async () => fake("a.canvas"));
    expect(await fresh.board).not.toBe(await a.board);
    a.release();
    b.release();
    fresh.release();
  });

  it("forgets a board that could not be read", async () => {
    const lease = leaseBoard("a.canvas", () => Promise.reject(new Error("gone")));
    await expect(lease.board).rejects.toThrow("gone");
    expect(heldBoards()).toBe(0);
  });
});
