// The kit's client (`kasten.*`, as a page uses it) against this host, with
// nothing faked between them but the frame's window: what the kit sends is what
// the host accepts, and what the host answers is what the kit reads.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CORE, loadKit } from "../../smart-kit/test-support/env";
import { WATCH_DEBOUNCE_MS } from "../../lib/vault/smart-types";
import { BridgeHost } from "./bridge-host";
import { FakeBackend } from "./test-support/fake-frame";

let host: BridgeHost;
let backend: FakeBackend;
let bridge: any;
let vaultChanged: () => void;

/** A kit in a page and a host in the window, joined as a frame joins them: a message from each goes to the other, a moment later. */
function join(options: { captureErrors?: boolean } = {}) {
  backend = new FakeBackend();
  let toKit: (message: unknown) => void = () => {};
  const frame = { postMessage: (message: unknown) => void queueMicrotask(() => toKit(message)) } as unknown as Window;
  host = new BridgeHost({
    pagePath: "projects/trip/tracker.md",
    pageId: "01PAGE",
    frameToken: "f".repeat(64),
    view: "Overview",
    backend,
    frame: () => frame,
    theme: () => "dark",
    onVaultChange: (listener) => {
      vaultChanged = listener;
      return () => {};
    },
  });
  const kit = loadKit(CORE);
  bridge = kit.start({
    captureErrors: options.captureErrors ?? false,
    transport: {
      post: (message: unknown) => host.handle({ data: message, source: frame }),
      listen: (fn: (message: unknown) => void) => {
        toKit = fn;
      },
    },
  });
  return kit;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  host?.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the kit and the host", () => {
  it("say hello to each other: the page learns its id, view and theme", async () => {
    join();
    host.frameLoaded();
    await vi.advanceTimersByTimeAsync(0);
    await expect(bridge.ready()).resolves.toEqual({ pageId: "01PAGE", theme: "dark", view: "Overview" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // The page followed the app's colours by asking, too (its first call).
    expect(await bridge.theme()).toBe("dark");
  });

  it("still say hello when the greeting came before the page's scripts ran", async () => {
    join();
    await vi.advanceTimersByTimeAsync(0);
    // The kit's first request (the theme) made the host greet again.
    await expect(bridge.ready()).resolves.toMatchObject({ pageId: "01PAGE", view: "Overview" });
  });

  it("carry reads and writes with the arguments the page gave", async () => {
    join();
    backend.answer = (call) => ({ kind: call.kind });
    expect(await bridge.query("venues")).toEqual({ kind: "query" });
    expect(await bridge.query({ tag: "venues", filter: [{ key: "status", value: "open" }], sort: [{ key: "deadline", dir: "asc" }], limit: 5 })).toEqual({ kind: "query" });
    await bridge.read("01ABC");
    await bridge.search("hotel", 5);
    await bridge.journal(new Date("2026-10-23T12:00:00Z"));
    await bridge.project();
    await bridge.update({ id: "01ABC", props: { status: "Open" } });
    await bridge.addTags({ id: "01ABC", tags: ["urgent"] });
    await bridge.createNote({ title: "A venue", tags: ["venue"], props: { city: "Lyon" } });
    await bridge.append({ id: "01ABC", md: "- more" });
    await bridge.toggle("01ABC", 1);
    expect(backend.asked.map((a) => a.call)).toEqual([
      { kind: "query", args: { tag: "venues" } },
      { kind: "query", args: { tag: "venues", filter: [{ key: "status", value: "open" }], sort: [{ key: "deadline", dir: "asc" }], limit: 5 } },
      { kind: "read", args: { id: "01ABC" } },
      { kind: "search", args: { q: "hotel", limit: 5 } },
      { kind: "journal", args: { date: "2026-10-23" } },
      { kind: "project" },
      { kind: "update", args: { id: "01ABC", props: { status: "Open" } } },
      { kind: "addTags", args: { id: "01ABC", tags: ["urgent"] } },
      { kind: "createNote", args: { title: "A venue", tags: ["venue"], props: { city: "Lyon" } } },
      { kind: "append", args: { id: "01ABC", md: "- more" } },
      { kind: "toggleTodo", args: { id: "01ABC", index: 1 } },
    ]);
    expect(backend.asked.every((a) => a.page === "projects/trip/tracker.md")).toBe(true);
  });

  it("turn a refusal into the kit's error, with the app's words", async () => {
    join();
    backend.answer = () => {
      throw { code: "refused", message: "That page is locked." };
    };
    await expect(bridge.update({ id: "01ABC", props: { a: 1 } })).rejects.toMatchObject({ code: "refused", message: "That page is locked.", retryable: false });
  });

  it("keep a watch live: the first result, then one after the vault changes, then none once it is stopped", async () => {
    join();
    let rows = [{ id: "a" }];
    backend.answer = () => rows;
    const seen: unknown[] = [];
    const stop = bridge.watch("venues", (value: unknown) => seen.push(value));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([[{ id: "a" }]]);
    rows = [{ id: "a" }, { id: "b" }];
    vaultChanged();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
    expect(seen).toEqual([[{ id: "a" }], [{ id: "a" }, { id: "b" }]]);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    rows = [];
    vaultChanged();
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS * 2);
    expect(seen).toHaveLength(2);
  });

  it("refuse a flood: past 50 calls in a second the kit gets rate_limited, a call to retry", async () => {
    join();
    const results = await Promise.allSettled(Array.from({ length: 60 }, (_, i) => bridge.read(`id${i}`)));
    await vi.advanceTimersByTimeAsync(0);
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(50);
    expect(refused.length).toBeGreaterThanOrEqual(10);
    expect(refused.every((r) => r.reason.code === "rate_limited" && r.reason.retryable === true)).toBe(true);
  });

  it("keep what the page's code reports", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    join({ captureErrors: true });
    console.error("the chart failed");
    window.dispatchEvent(new ErrorEvent("error", { message: "x is not defined", filename: "smart://localhost/01PAGE/app.js", lineno: 12 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.reports.map((r) => r.report)).toEqual([
      { kind: "console.error", message: "the chart failed" },
      { kind: "error", message: "x is not defined", source: "smart://localhost/01PAGE/app.js", line: 12 },
    ]);
  });
});
