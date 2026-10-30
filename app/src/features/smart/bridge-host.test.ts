// The window's side of the bridge, against a fake frame and a fake app: every
// kind of request, what is refused, the rate and size limits, whose messages
// are heard, and the watches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_CALLS_PER_SECOND } from "../../lib/vault/smart-types";
import { MAX_IN_FLIGHT, MIN_HEIGHT_PX } from "./bridge-host";
import { argsOf, fakeWindow, request } from "./test-support/fake-frame";
import { FRAME, PAGE, rig, settle } from "./test-support/rig";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the reads and writes a page may ask for", () => {
  it("passes every read to the app for this page and sends back what comes", async () => {
    const r = rig();
    r.backend.answer = (call) => ({ was: call.kind });
    const reads: [string, unknown][] = [
      ["query", { tag: "venues", filter: [{ key: "status", op: "is", value: "open" }], sort: [{ key: "deadline", dir: "asc" }], limit: 10 }],
      ["list", { project: "trip", tag: "venue", type: "page" }],
      ["read", { id: "01ABC" }],
      ["search", { q: "hotel", limit: 5 }],
      ["journal", { date: "2026-10-23" }],
      ["tasks", { project: "trip", done: false }],
      ["board", { path: "projects/trip/boards/plan.canvas" }],
    ];
    reads.forEach(([kind, args], i) => r.say(request(i + 1, kind, args)));
    r.say(request(20, "project"));
    await settle();
    expect(r.backend.asked.map((a) => a.call.kind)).toEqual([...reads.map(([k]) => k), "project"]);
    // The app is told which page it is for, and gets the call without the page's own request number.
    expect(r.backend.asked.every((a) => a.page === PAGE)).toBe(true);
    expect(r.backend.asked[0]!.call).toEqual({ kind: "query", args: reads[0]![1] });
    expect(r.backend.asked.at(-1)!.call).toEqual({ kind: "project" });
    expect(r.answers()).toHaveLength(8);
    expect(r.answers()[0]).toEqual({ id: 1, ok: true, value: { was: "query" } });
    expect(r.answers().at(-1)).toEqual({ id: 20, ok: true, value: { was: "project" } });
  });

  it("passes every write to the app, which makes it as the page's agent", async () => {
    const r = rig();
    r.backend.answer = () => ({ status: "done" });
    const writes: [string, unknown][] = [
      ["update", { id: "01ABC", props: { status: "Open" } }],
      ["addTags", { id: "01ABC", tags: ["urgent"] }],
      ["createNote", { title: "A venue", tags: ["venue"], props: { city: "Lyon" }, body: "Nice.", project: "trip" }],
      ["append", { id: "01ABC", md: "- more" }],
      ["toggleTodo", { id: "01ABC", index: 2 }],
    ];
    writes.forEach(([kind, args], i) => r.say(request(i + 1, kind, args)));
    await settle();
    expect(r.backend.asked.map((a) => [a.page, a.call.kind])).toEqual(writes.map(([kind]) => [PAGE, kind]));
    expect(r.answers().every((a) => a.ok)).toBe(true);
    expect(r.answers()).toHaveLength(5);
  });

  it("makes every call to the app, reads, writes, queries of a watch and reports alike, with the secret of its own frame", async () => {
    const r = rig();
    r.backend.answer = () => [];
    r.say(request(1, "read", { id: "a" }));
    r.say(request(2, "append", { id: "a", md: "x" }));
    r.say(request(3, "report", { kind: "error", message: "boom" }));
    r.say(request(4, "watch", { watchId: "w", query: { tag: "venue" } }));
    await settle();
    r.change();
    await vi.advanceTimersByTimeAsync(300);
    expect(r.backend.askedBy.length).toBeGreaterThanOrEqual(5);
    expect(r.backend.askedBy.every((frame) => frame === FRAME)).toBe(true);
  });

  it("hands on what the app refuses, with its words and code; any other failure becomes a plain one", async () => {
    const r = rig();
    r.backend.answer = (call) => {
      if (call.kind === "update") throw { code: "refused", message: "That page is locked." };
      if (call.kind === "read") throw "boom";
      if (call.kind === "append") throw new Error("disk full");
      throw { code: "weird", message: "x" };
    };
    r.say(request(1, "update", { id: "a", props: {} }));
    r.say(request(2, "read", { id: "a" }));
    r.say(request(3, "append", { id: "a", md: "x" }));
    r.say(request(4, "search", { q: "x" }));
    await settle();
    const [a, b, c, d] = r.answers() as { id: number; ok: false; error: { code: string; message: string } }[];
    expect(a!.error).toEqual({ code: "refused", message: "That page is locked." });
    expect(b!.error).toEqual({ code: "bad_request", message: "boom" });
    expect(c!.error).toEqual({ code: "refused", message: "disk full" });
    expect(d!.error.code).toBe("bad_request");
  });
});

describe("the page's own housekeeping", () => {
  it("answers the theme, and sends a new one when the app changes", async () => {
    const r = rig();
    r.say(request(1, "theme"));
    await settle();
    expect(r.answers()[0]).toEqual({ id: 1, ok: true, value: "light" });
    r.theme.value = "dark";
    r.host.sendTheme("dark");
    expect(r.events().at(-1)).toEqual({ event: "theme", theme: "dark" });
  });

  it("keeps a requested height within what the page may have", async () => {
    const r = rig({ maxHeight: 500 });
    for (const px of [1, 300, 499, 500, 900, 100_000]) r.say(request(px, "resize", { px }));
    await settle();
    expect(r.resized).toEqual([MIN_HEIGHT_PX, 300, 499, 500, 500, 500]);
    const tall = rig();
    tall.say(request(1, "resize", { px: 99_999 }));
    await settle();
    expect(tall.resized).toEqual([1200]);
  });

  it("passes on what it logs, keeps what it reports, and opens what it names", async () => {
    const r = rig();
    r.backend.answer = () => ({ path: "projects/trip/pages/hotel.md" });
    r.say(request(1, "log", { args: ["hi", 2, { a: 1 }] }));
    r.say(request(2, "report", { kind: "error", message: "boom", source: "app.js", line: 3 }));
    r.say(request(3, "open", { target: "01ABC" }));
    await settle();
    expect(r.logged).toEqual([["hi", 2, { a: 1 }]]);
    expect(r.backend.reports).toEqual([{ page: PAGE, report: { kind: "error", message: "boom", source: "app.js", line: 3 } }]);
    expect(r.reported.count).toBe(1);
    expect(r.opened).toEqual(["projects/trip/pages/hotel.md"]);
    expect(r.answers().map((a) => a.ok)).toEqual([true, true, true]);
  });

  it("opens one note a second at most, so a page cannot flip through the person's notes", async () => {
    let clock = 1_000;
    const r = rig({ now: () => clock });
    r.backend.answer = () => ({ path: "a.md" });
    for (let i = 1; i <= 5; i++) r.say(request(i, "open", { target: "01ABC" }));
    await settle();
    expect(r.opened).toEqual(["a.md"]);
    const refused = r.answers().filter((a) => !a.ok) as { error: { code: string } }[];
    expect(refused).toHaveLength(4);
    expect(refused.every((a) => a.error.code === "rate_limited")).toBe(true);
    expect(r.backend.asked).toHaveLength(1);
    clock += 1_000;
    r.say(request(9, "open", { target: "01ABC" }));
    await settle();
    expect(r.opened).toEqual(["a.md", "a.md"]);
  });

  it("opens nothing, and answers nothing, once the host has been disposed while the app was resolving the note", async () => {
    const r = rig();
    let finish: (value: unknown) => void = () => {};
    r.backend.answer = () => new Promise((resolve) => (finish = resolve));
    r.say(request(1, "open", { target: "01ABC" }));
    await settle();
    r.host.dispose();
    finish({ path: "a.md" });
    await settle();
    expect(r.opened).toEqual([]);
    expect(r.answers()).toEqual([]);
  });

  it("greets the frame when it loads and again on the first request, once", async () => {
    const r = rig({ view: "Overview" });
    r.host.frameLoaded();
    expect(r.events()).toEqual([{ event: "init", pageId: "01PAGE", theme: "light", view: "Overview" }]);
    r.say(request(1, "theme"));
    r.say(request(2, "theme"));
    await settle();
    expect(r.events().map((e) => e.event)).toEqual(["init", "init"]);
    // The greeting comes before the first answer.
    expect(r.sent()[1]).toMatchObject({ event: "init" });
    expect(r.sent()[2]).toMatchObject({ id: 1, ok: true });
    expect(r.sent()).toHaveLength(4);
    // With no load heard, the first request is greeted all the same; a refused one is not.
    const late = rig();
    late.say(request(1, "nonsense"));
    late.say(request(2, "theme"));
    await settle();
    expect(late.events().map((e) => e.event)).toEqual(["init"]);
    expect(late.sent().map((m) => ("event" in (m as object) ? "init" : (m as { id: number }).id))).toEqual([1, "init", 2]);
  });
});

describe("what is not accepted", () => {
  it("answers a message that does not fit the contract with a plain bad_request, and does nothing", async () => {
    const r = rig();
    const bad: unknown[] = [
      request(1, "deleteEverything", { all: true }),
      request(2, "read", {}),
      request(3, "read", { id: 5 }),
      request(4, "query", { tag: "" }),
      request(5, "update", { id: "a", props: "x" }),
      request(6, "journal", { date: "yesterday" }),
      request(7, "resize", { px: -4 }),
      request(8, "append", { id: "a", md: "x".repeat(1_000_001) }),
      request(9, "project", { surprise: true }),
      // A key that would reach the prototype of what the app builds.
      { id: 10, kind: "query", args: JSON.parse('{"tag":"t","filter":[{"key":"k","value":{"__proto__":{"x":1}}}]}') },
    ];
    for (const message of bad) r.say(message);
    await settle();
    expect(r.backend.asked).toEqual([]);
    const answers = r.answers() as { id: number; ok: false; error: { code: string } }[];
    expect(answers.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(answers.every((a) => !a.ok && a.error.code === "bad_request")).toBe(true);
  });

  it("says nothing to a message with no number to answer to, or no shape at all", async () => {
    const r = rig();
    for (const message of [null, undefined, "read", 42, [], { kind: "read", args: { id: "a" } }, { id: "1", kind: "theme" }, { id: -1, kind: "theme" }, { id: 1.5, kind: "theme" }]) {
      r.say(message);
    }
    await settle();
    expect(r.backend.asked).toEqual([]);
    expect(r.sent()).toEqual([]);
  });

  it("builds the request from the fields it knows, so nothing else a page adds goes on to the app", async () => {
    const r = rig();
    r.say({ id: 1, kind: "read", args: { id: "01ABC", sneaky: "yes" }, evil: true });
    await settle();
    expect(r.backend.asked[0]!.call).toEqual({ kind: "read", args: { id: "01ABC" } });
  });

  it("hears the frame and nobody else", async () => {
    const r = rig();
    const other = fakeWindow();
    for (const source of [other, window, null, undefined, {}, "frame"]) r.say(request(1, "theme"), source);
    await settle();
    expect(r.sent()).toEqual([]);
    expect(other.sent).toEqual([]);
    r.say(request(1, "theme"));
    await settle();
    expect(r.answers()).toHaveLength(1);
    // A frame that is no longer there is nobody either.
    const gone = rig({ frame: () => null });
    gone.say(request(1, "theme"), other);
    await settle();
    expect(gone.sent()).toEqual([]);
  });

  it("listens on the window's message events through attach, and stops when told", async () => {
    const r = rig();
    const target = new EventTarget();
    const stop = r.host.attach(target as unknown as Window);
    const send = (data: unknown, source: unknown) => {
      const event = new Event("message") as Event & { data: unknown; source: unknown };
      event.data = data;
      event.source = source;
      target.dispatchEvent(event);
    };
    send(request(1, "theme"), r.frame);
    send(request(2, "theme"), window);
    await settle();
    expect(r.answers().map((a) => a.id)).toEqual([1]);
    stop();
    send(request(3, "theme"), r.frame);
    await settle();
    expect(r.answers()).toHaveLength(1);
  });
});

describe("the limits", () => {
  it("answers 50 calls a second and refuses the rest with rate_limited, then lets calls through again", async () => {
    let clock = 10_000;
    const r = rig({ now: () => clock });
    for (let i = 1; i <= MAX_CALLS_PER_SECOND + 5; i++) r.say(request(i, "theme"));
    await settle();
    const answers = r.answers() as { id: number; ok: boolean; error?: { code: string } }[];
    expect(answers.filter((a) => a.ok)).toHaveLength(MAX_CALLS_PER_SECOND);
    const refused = answers.filter((a) => !a.ok);
    expect(refused.map((a) => a.id)).toEqual([51, 52, 53, 54, 55]);
    expect(refused.every((a) => a.error!.code === "rate_limited")).toBe(true);
    // Nothing was run for the refused ones.
    clock += 999;
    r.say(request(100, "theme"));
    await settle();
    expect(r.answers().at(-1)).toMatchObject({ id: 100, ok: false });
    clock += 1;
    r.say(request(101, "theme"));
    await settle();
    expect(r.answers().at(-1)).toMatchObject({ id: 101, ok: true });
  });

  it("goes quiet when a page keeps hammering, and does not read what it sends", async () => {
    const r = rig({ now: () => 5_000 });
    for (let i = 0; i < 1_000; i++) r.say(request(i, "query", { tag: "venues" }));
    await settle();
    // Sent all at once, only so many wait for the app at a time; the rest are refused without reaching it.
    expect(r.backend.asked).toHaveLength(MAX_IN_FLIGHT);
    // Fifty answers, at most fifty refusals, and the one greeting.
    expect(r.sent().length).toBeLessThanOrEqual(2 * MAX_CALLS_PER_SECOND + 1);
    // The rate counts every message, those that do not fit too.
    const bad = rig({ now: () => 5_000 });
    for (let i = 0; i < 80; i++) bad.say({ id: i, kind: "nonsense" });
    const codes = (bad.answers() as { error: { code: string } }[]).map((a) => a.error.code);
    expect(codes.filter((c) => c === "bad_request")).toHaveLength(MAX_CALLS_PER_SECOND);
    expect(codes.filter((c) => c === "rate_limited")).toHaveLength(30);
  });

  it("lets only so many calls wait for the app at once, and a finished one gives its place back", async () => {
    const r = rig({ now: () => 7_000 });
    const held: (() => void)[] = [];
    r.backend.answer = () => new Promise<void>((resolve) => held.push(resolve));
    // Slow answers: the app is still busy with the first ones when the next arrive.
    for (let i = 1; i <= MAX_IN_FLIGHT + 5; i++) r.say(request(i, "read", { id: `n${i}` }));
    await settle();
    expect(r.backend.asked).toHaveLength(MAX_IN_FLIGHT);
    const refused = (r.answers() as { id: number; ok: boolean; error?: { code: string } }[]).filter((a) => !a.ok);
    expect(refused.map((a) => a.id)).toEqual([33, 34, 35, 36, 37]);
    expect(refused.every((a) => a.error!.code === "rate_limited")).toBe(true);
    // One finishes; the next call is let in (the clock has moved on, so the rate is not what stops it).
    held[0]!();
    await settle();
    r.say(request(100, "read", { id: "later" }));
    await settle();
    expect(r.backend.asked).toHaveLength(MAX_IN_FLIGHT + 1);
    expect(r.answers().some((a) => (a as { id: number }).id === 1)).toBe(true);
  });

  it("cuts an answer over 2 MB into an error, counting bytes and not letters", async () => {
    const r = rig();
    const sizes: Record<string, unknown> = {
      small: "x".repeat(1_900_000),
      twoByte: "é".repeat(900_000),
      threeByte: "€".repeat(900_000),
      tooMany: "x".repeat(2 * 1024 * 1024 + 1),
      rows: Array.from({ length: 30_000 }, (_, i) => ({ id: i, title: `A note called ${i}`, props: { a: "x".repeat(50) } })),
    };
    r.backend.answer = (call) => sizes[argsOf<{ id: string }>(call).id];
    for (const [i, id] of Object.keys(sizes).entries()) r.say(request(i + 1, "read", { id }));
    await settle();
    const answers = r.answers() as { id: number; ok: boolean; error?: { code: string; message: string } }[];
    expect(answers.map((a) => a.ok)).toEqual([true, true, false, false, false]);
    expect(answers[2]!.error!.code).toBe("too_large");
    expect(answers[3]!.error!.message).toContain("2 MB");
    expect(answers[4]!.error!.code).toBe("too_large");
  });
});

