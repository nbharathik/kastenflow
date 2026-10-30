// A page's live queries (`watch`): re-run 300 ms after the vault changes, sent
// only when the result is new, silent while the frame is paused, and gone
// when the host is disposed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WATCH_DEBOUNCE_MS } from "../../lib/vault/smart-types";
import { MAX_WATCHES } from "./bridge-host";
import { argsOf, request } from "./test-support/fake-frame";
import { rig, settle } from "./test-support/rig";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("watches", () => {
  it("answers the first result at once and sends a new one 300 ms after the vault changes, once for many changes", async () => {
    const r = rig();
    let rows = [{ id: "a" }];
    r.backend.answer = () => rows;
    r.say(request(1, "watch", { watchId: "w1", query: { tag: "venues" } }));
    await settle();
    expect(r.answers()).toEqual([{ id: 1, ok: true, value: [{ id: "a" }] }]);
    expect(r.backend.asked).toHaveLength(1);
    rows = [{ id: "a" }, { id: "b" }];
    // Each change starts the wait again, so a burst of them is one run.
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS - 1);
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS - 1);
    r.change();
    expect(r.backend.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS - 1);
    expect(r.backend.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.backend.asked).toHaveLength(2);
    expect(r.watched()).toEqual([{ event: "watch", watchId: "w1", value: [{ id: "a" }, { id: "b" }] }]);
    // The same result is not sent again.
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(r.backend.asked).toHaveLength(3);
    expect(r.watched()).toHaveLength(1);
  });

  it("runs each watch of the page on a change, and a watch the page stops no more", async () => {
    const r = rig();
    const rows: Record<string, unknown> = { venues: [1], hotels: [1] };
    r.backend.answer = (call) => rows[argsOf<{ tag: string }>(call).tag];
    r.say(request(1, "watch", { watchId: "v", query: { tag: "venues" } }));
    r.say(request(2, "watch", { watchId: "h", query: { tag: "hotels" } }));
    await settle();
    expect(r.subscribers.count).toBe(1);
    rows.venues = [1, 2];
    rows.hotels = [1, 2];
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(r.watched().map((e) => e.watchId)).toEqual(["v", "h"]);
    r.say(request(3, "unwatch", { watchId: "v" }));
    await settle();
    expect(r.stops.count).toBe(0);
    rows.venues = [1, 2, 3];
    rows.hotels = [1, 2, 3];
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(r.watched().map((e) => e.watchId)).toEqual(["v", "h", "h"]);
    // The last watch gone: the host stops listening to the vault.
    r.say(request(4, "unwatch", { watchId: "h" }));
    await settle();
    expect(r.stops.count).toBe(1);
    expect(r.answers().filter((a) => a.id >= 3).every((a) => a.ok)).toBe(true);
  });

  it("is unsubscribed, and its timer stopped, when it is disposed", async () => {
    const r = rig();
    r.backend.answer = () => [1];
    r.say(request(1, "watch", { watchId: "w", query: { tag: "venues" } }));
    await settle();
    r.change();
    expect(vi.getTimerCount()).toBe(1);
    r.host.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.stops.count).toBe(1);
    r.backend.answer = () => [1, 2];
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS * 3);
    expect(r.backend.asked).toHaveLength(1);
    expect(r.watched()).toEqual([]);
    // A message after that is not heard.
    r.say(request(2, "theme"));
    await settle();
    expect(r.answers()).toHaveLength(1);
  });

  it("is quiet when it is disposed with a query still on its way", async () => {
    const r = rig();
    let release: (value: unknown) => void = () => {};
    r.backend.answer = () => new Promise((resolve) => (release = resolve));
    r.say(request(1, "watch", { watchId: "w", query: { tag: "venues" } }));
    await settle();
    r.host.dispose();
    release([1]);
    await settle();
    expect(r.answers()).toEqual([]);
    expect(r.subscribers.count).toBe(0);
  });

  it("sends nothing while paused, and brings the page up to date once when it wakes", async () => {
    const r = rig();
    let rows = [1];
    r.backend.answer = () => rows;
    r.say(request(1, "watch", { watchId: "w", query: { tag: "venues" } }));
    await settle();
    r.host.setPaused(true);
    rows = [1, 2];
    r.change();
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS * 5);
    expect(r.backend.asked).toHaveLength(1);
    expect(r.watched()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    r.host.setPaused(false);
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(r.watched()).toEqual([{ event: "watch", watchId: "w", value: [1, 2] }]);
    // Waking up with nothing changed asks for nothing.
    r.host.setPaused(true);
    r.host.setPaused(false);
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS * 2);
    expect(r.backend.asked).toHaveLength(2);
  });

  it("cannot be talked past its 20 watches by asking for many at once while the app is still answering", async () => {
    const r = rig();
    const waiting: ((value: unknown) => void)[] = [];
    r.backend.answer = () => new Promise((resolve) => waiting.push(resolve));
    for (let i = 0; i < 45; i++) r.say(request(i + 1, "watch", { watchId: `w${i}`, query: { tag: "t" } }));
    await settle();
    // Only the 20 that fit were run; the rest were told so at once.
    expect(r.backend.asked).toHaveLength(MAX_WATCHES);
    const refused = (r.answers() as { id: number; ok: boolean; error?: { code: string } }[]).filter((a) => !a.ok);
    expect(refused).toHaveLength(45 - MAX_WATCHES);
    expect(refused.every((a) => a.error!.code === "refused")).toBe(true);
    waiting.forEach((resolve) => resolve([1]));
    await settle();
    expect((r.answers() as { ok: boolean }[]).filter((a) => a.ok)).toHaveLength(MAX_WATCHES);
    // And every change runs 20 queries, not more.
    r.backend.asked.length = 0;
    waiting.length = 0;
    r.backend.answer = () => [1, 2];
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(r.backend.asked).toHaveLength(MAX_WATCHES);
  });

  it("forgets a watch the page stopped before its first answer came, and keeps nothing for it", async () => {
    const r = rig();
    let release: (value: unknown) => void = () => {};
    r.backend.answer = () => new Promise((resolve) => (release = resolve));
    r.say(request(1, "watch", { watchId: "w", query: { tag: "venues" } }));
    await settle();
    r.say(request(2, "unwatch", { watchId: "w" }));
    await settle();
    release([1]);
    await settle();
    // The page is answered, and the host listens to nothing and runs nothing.
    expect(r.answers().map((a) => a.id).sort()).toEqual([1, 2]);
    expect(r.subscribers.count).toBe(0);
    r.backend.answer = () => [1, 2];
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS * 2);
    expect(r.backend.asked).toHaveLength(1);
    expect(r.watched()).toEqual([]);
  });

  it("keeps at most 20 watches, lets a watch be replaced, and survives a query that fails", async () => {
    const r = rig();
    r.backend.answer = () => [1];
    for (let i = 0; i < MAX_WATCHES; i++) r.say(request(i + 1, "watch", { watchId: `w${i}`, query: { tag: "t" } }));
    await settle();
    r.say(request(100, "watch", { watchId: "one-too-many", query: { tag: "t" } }));
    r.say(request(101, "watch", { watchId: "w0", query: { tag: "other" } }));
    await settle();
    const answers = r.answers() as { id: number; ok: boolean; error?: { code: string } }[];
    expect(answers.find((a) => a.id === 100)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(answers.find((a) => a.id === 101)).toMatchObject({ ok: true });
    // One that fails to run does not stop the rest, and is tried again at the next change.
    r.backend.answer = (call) => {
      if (argsOf<{ tag: string }>(call).tag === "other") throw new Error("no");
      return [1, 2];
    };
    r.change();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(r.watched()).toHaveLength(MAX_WATCHES - 1);
    // A watch whose first result fails is answered with the error and is not kept.
    const failing = rig();
    failing.backend.answer = () => {
      throw { code: "not_found", message: "No such tag." };
    };
    failing.say(request(1, "watch", { watchId: "w", query: { tag: "nope" } }));
    await settle();
    expect(failing.answers()[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(failing.subscribers.count).toBe(0);
  });
});
