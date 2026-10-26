import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIDGE_ERROR_CODES, WRITE_KINDS, isBridgeError, parseBridgeRequest, type BridgeKind } from "../lib/vault/smart-types";
import { fakeHost, flush, loadKit, type Kit } from "./test-support/env";

let kit: Kit;
beforeEach(() => {
  kit = loadKit(["kit.js", "lib/dates.js"]);
});
afterEach(() => {
  kit.stop();
  vi.useRealTimers();
});

function bridgeWith(host: ReturnType<typeof fakeHost>, timeout?: number) {
  return kit.createBridge({ transport: host.transport, timeout });
}

describe("bridge client", () => {
  it("matches answers to requests by id, in any order", async () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    const first = b.read("n1");
    const second = b.read("n2");
    expect(host.sent.map((m) => m.id)).toEqual([1, 2]);
    host.answer(2, { id: "n2" });
    host.answer(1, { id: "n1" });
    await expect(first).resolves.toEqual({ id: "n1" });
    await expect(second).resolves.toEqual({ id: "n2" });
    expect(b.pendingCount()).toBe(0);
  });

  it("sends the wire shape {id, kind, args}, with no args for project and theme", () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    void b.query({ tag: "paper", limit: 5 });
    void b.project();
    void b.theme();
    void b.search("graph", 3);
    void b.journal(new Date(2027, 2, 1));
    expect(host.sent[0]).toEqual({ id: 1, kind: "query", args: { tag: "paper", limit: 5 } });
    expect(host.sent[1]).toEqual({ id: 2, kind: "project" });
    expect(host.sent[2]).toEqual({ id: 3, kind: "theme" });
    expect(host.sent[3]).toEqual({ id: 4, kind: "search", args: { q: "graph", limit: 3 } });
    expect(host.sent[4]).toEqual({ id: 5, kind: "journal", args: { date: "2027-03-01" } });
  });

  it("sends only what the app's own request check accepts", () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    void b.query({ tag: "t", filter: [{ key: "status", op: "is", value: "open" }], sort: [{ key: "due", dir: "asc" }], limit: 10 });
    void b.list({ project: "p" });
    void b.read("n");
    void b.search("q");
    void b.journal("2027-03-01");
    void b.project();
    void b.tasks({ done: false });
    void b.board({ path: "boards/a.board" });
    void b.open("n");
    void b.theme();
    void b.resize(200);
    b.log("a");
    void b.report({ kind: "error", message: "m", line: 3 });
    void b.update({ id: "n", props: { a: 1 } });
    void b.addTags({ id: "n", tags: ["x"] });
    void b.createNote({ title: "T", tags: ["x"], body: "b" });
    void b.append({ id: "n", md: "text" });
    void b.toggleTodo({ id: "n", index: 0 });
    b.watch({ tag: "t" }, () => {})();
    expect(host.sent.length).toBeGreaterThan(18);
    for (const m of host.sent) expect(isBridgeError(parseBridgeRequest(m)), JSON.stringify(m)).toBe(false);
  });

  it("takes shorthand: a tag for query, an id for read, a number for resize", () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    void b.query("paper");
    void b.open("a/b.md");
    void b.resize(300);
    expect(host.sent.map((m) => m.args)).toEqual([{ tag: "paper" }, { target: "a/b.md" }, { px: 300 }]);
  });

  it("has a call for every contract kind", () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    const kinds: BridgeKind[] = ["query", "list", "read", "search", "journal", "project", "tasks", "board", "watch", "unwatch", "open", "theme", "resize", "log", "report", "update", "addTags", "createNote", "append", "toggleTodo"];
    expect([...kit.bridgeKinds].sort()).toEqual([...kinds].sort());
    for (const k of WRITE_KINDS) expect(typeof b[k]).toBe("function");
  });

  it("times out with a typed, retryable error and forgets the request", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const b = bridgeWith(host, 500);
    const p = b.list({});
    const caught = p.catch((e: Error) => e);
    vi.advanceTimersByTime(501);
    const err = (await caught) as Kit;
    expect(err).toBeInstanceOf(kit.KastenError);
    expect(err.code).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(b.pendingCount()).toBe(0);
    host.answer(1, []); // a late answer is ignored
  });

  it("checks arguments before sending: a schema error is bad_request and nothing is posted", async () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    await expect(b.read("")).rejects.toMatchObject({ code: "bad_request" });
    await expect(b.journal("tomorrow")).rejects.toMatchObject({ code: "bad_request" });
    await expect(b.toggleTodo({ id: "n", index: -1 })).rejects.toMatchObject({ code: "bad_request" });
    await expect(b.addTags({ id: "n", tags: [1] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(b.call("nope", {})).rejects.toMatchObject({ code: "bad_request" });
    expect(host.sent).toHaveLength(0);
  });

  it("turns every host error code into a KastenError, rate limits included", async () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    for (const code of BRIDGE_ERROR_CODES) {
      const p = b.read("n");
      host.fail(host.sent.length, code, "Plain sentence.");
      const err = (await p.catch((e: Error) => e)) as Kit;
      expect(err.name).toBe("KastenError");
      expect(err.code).toBe(code);
      expect(err.message).toBe("Plain sentence.");
      expect(err.retryable).toBe(code === "rate_limited");
    }
  });

  it("rejects an answer it cannot read as bad_response", async () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    const p = b.read("n");
    host.raw({ id: 1, ok: "maybe" });
    await expect(p).rejects.toMatchObject({ code: "bad_response" });
    const q = b.read("n");
    host.raw({ id: 2, ok: false, error: { code: "weird", message: "x" } });
    await expect(q).rejects.toMatchObject({ code: "bad_response" });
  });

  it("surfaces a transport failure as closed", async () => {
    const b = kit.createBridge({
      transport: {
        post() {
          throw new Error("gone");
        },
        listen() {},
      },
    });
    await expect(b.read("n")).rejects.toMatchObject({ code: "closed" });
    expect(b.pendingCount()).toBe(0);
  });

  it("ignores messages that are not answers or events", () => {
    const host = fakeHost();
    bridgeWith(host);
    expect(() => {
      host.raw(null);
      host.raw("hello");
      host.raw({ id: 99, ok: true });
      host.raw({ event: "mystery" });
    }).not.toThrow();
  });
});

describe("watch", () => {
  it("calls back with the first answer and with each later watch event, then stops", async () => {
    const host = fakeHost({ watch: () => [{ id: "a" }], unwatch: undefined });
    const b = bridgeWith(host);
    const seen: unknown[] = [];
    const stop = b.watch({ tag: "paper" }, (v: unknown) => seen.push(v));
    await flush();
    const watchId = host.ofKind("watch")[0].args.watchId;
    expect(host.ofKind("watch")[0].args.query).toEqual({ tag: "paper" });
    expect(seen).toEqual([[{ id: "a" }]]);
    host.emit({ event: "watch", watchId, value: [{ id: "a" }, { id: "b" }] });
    expect(seen).toHaveLength(2);
    host.emit({ event: "watch", watchId: "other", value: [] });
    expect(seen).toHaveLength(2);
    stop();
    stop();
    expect(host.ofKind("unwatch")).toHaveLength(1);
    expect(host.ofKind("unwatch")[0].args).toEqual({ watchId });
    host.emit({ event: "watch", watchId, value: [] });
    expect(seen).toHaveLength(2);
  });

  it("accepts a bare tag and gives each watch its own id", async () => {
    const host = fakeHost({ watch: [] });
    const b = bridgeWith(host);
    b.watch("a", () => {});
    b.watch("b", () => {});
    const ids = host.ofKind("watch").map((m) => m.args.watchId);
    expect(new Set(ids).size).toBe(2);
    expect(host.ofKind("watch")[0].args.query).toEqual({ tag: "a" });
  });

  it("reports a failed watch (a rate limit, say) to onError and drops it", async () => {
    const host = fakeHost({
      watch: () => {
        throw { code: "rate_limited", message: "Slow down." };
      },
    });
    const b = bridgeWith(host);
    const errors: Kit[] = [];
    const cb = vi.fn();
    b.watch({ tag: "x" }, cb, (e: Kit) => errors.push(e));
    await flush();
    expect(cb).not.toHaveBeenCalled();
    expect(errors[0].code).toBe("rate_limited");
    expect(errors[0].retryable).toBe(true);
  });
});

describe("ready and theme", () => {
  it("ready resolves with the init event, now or later", async () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    const early = b.ready();
    host.emit({ event: "init", pageId: "p1", theme: "dark", view: "intro" });
    await expect(early).resolves.toEqual({ pageId: "p1", theme: "dark", view: "intro" });
    await expect(b.ready()).resolves.toMatchObject({ pageId: "p1" });
    expect(b.currentTheme()).toBe("dark");
  });

  it("tells theme listeners about init and later theme events, and lets them go", () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    const seen: string[] = [];
    const off = b.onTheme((t: string) => seen.push(t));
    host.emit({ event: "init", pageId: "p", theme: "light" });
    host.emit({ event: "theme", theme: "dark" });
    host.emit({ event: "theme", theme: "purple" });
    off();
    host.emit({ event: "theme", theme: "light" });
    expect(seen).toEqual(["light", "dark"]);
  });

  it("start() follows the app's theme on <html> and asks for it if the hello was missed", async () => {
    const host = fakeHost({ theme: "dark" });
    const b = kit.start({ transport: host.transport });
    expect((window as unknown as { kasten: unknown }).kasten).toBe(b);
    await flush();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await expect(b.ready()).resolves.toMatchObject({ theme: "dark" });
    host.emit({ event: "theme", theme: "light" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    host.emit({ event: "init", pageId: "page-9", theme: "light" });
    await expect(b.ready()).resolves.toMatchObject({ pageId: "page-9" });
  });
});

describe("error capture", () => {
  it("posts error, unhandledrejection and console.error as report calls", async () => {
    const host = fakeHost({ report: undefined });
    kit.start({ transport: host.transport });
    const original = console.error;
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "smart://p/app.js", lineno: 12 }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("nope");
    window.dispatchEvent(rejection);
    const spy = vi.fn();
    kit.stop();
    console.error = spy;
    kit.start({ transport: host.transport });
    console.error("bad", { a: 1 });
    kit.stop();
    expect(console.error).toBe(spy);
    console.error = original;
    const reports = host.ofKind("report").map((m) => m.args);
    expect(reports).toEqual([
      { kind: "error", message: "boom", source: "smart://p/app.js", line: 12 },
      { kind: "unhandledrejection", message: "nope" },
      { kind: "console.error", message: 'bad {"a":1}' },
    ]);
    expect(spy).toHaveBeenCalledWith("bad", { a: 1 });
  });

  it("stops after its limit and never reports its own failures in a loop", async () => {
    const host = fakeHost({
      report: () => {
        throw { code: "rate_limited", message: "Slow down." };
      },
    });
    const b = kit.createBridge({ transport: host.transport });
    const fakeConsole = { error: vi.fn() };
    const win = new EventTarget() as unknown as Window;
    (win as unknown as { console: unknown }).console = fakeConsole;
    const undo = kit.captureErrors(b, win, 3);
    for (let i = 0; i < 10; i++) fakeConsole.error("x" + i);
    await flush();
    expect(host.ofKind("report")).toHaveLength(3);
    undo();
  });
});

describe("log", () => {
  it("sends plain JSON-safe arguments", () => {
    const host = fakeHost();
    const b = bridgeWith(host);
    b.log("hi", 3, undefined, new Error("x"), () => 1, { deep: { a: 1 } });
    expect(host.sent[0]).toEqual({ id: 1, kind: "log", args: { args: ["hi", 3, null, "Error: x", "[function]", { deep: { a: 1 } }] } });
  });
});
