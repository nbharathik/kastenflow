import { describe, expect, it } from "vitest";

import {
  MAX_QUERY_LIMIT,
  SMART_CSP,
  isAllowedPath,
  isBridgeError,
  isWriteCall,
  kitUrl,
  parseBridgeRequest,
  requestIdOf,
  sidecarDir,
  smartCsp,
  type BridgeRequest,
} from "./smart-types";

function ok(raw: unknown): BridgeRequest {
  const out = parseBridgeRequest(raw);
  if (isBridgeError(out)) throw new Error(`refused: ${out.message}`);
  return out;
}

function refused(raw: unknown): string {
  const out = parseBridgeRequest(raw);
  if (!isBridgeError(out)) throw new Error(`accepted: ${JSON.stringify(out)}`);
  expect(out.code).toBe("bad_request");
  expect(out.message).not.toBe("");
  return out.message;
}

describe("urls and policy", () => {
  it("builds the kit's address as a page's own markup names it", () => {
    expect(kitUrl("1", "kit.css")).toBe("smart://kit/1/kit.css");
    expect(kitUrl("1", "/lib/a b.js")).toBe("smart://kit/1/lib/a%20b.js");
  });

  it("allows no network and adds web pictures only on request", () => {
    expect(SMART_CSP).toContain("default-src 'none'");
    expect(SMART_CSP).toContain("connect-src 'none'");
    // These two do not fall back to default-src, so they are named.
    expect(SMART_CSP.endsWith("; base-uri 'none'; form-action 'none'")).toBe(true);
    expect(SMART_CSP).not.toContain("https:");
    expect(smartCsp(true).replace(" https:", "")).toBe(SMART_CSP);
    expect(smartCsp(false)).toBe(SMART_CSP);
    expect(smartCsp(true)).toContain("img-src 'self' data: blob: https:");
  });

  it("knows which paths a folder may hold", () => {
    for (const p of ["index.html", "app.js", "css/site.CSS", "data/v.json", "assets/a/pin.svg", "assets/p.webp", "assets/p.jpg", "notes.txt", "smart.yaml"]) {
      expect(isAllowedPath(p), p).toBe(true);
    }
    for (const p of ["", "/index.html", "../x.js", "a/../b.js", "a//b.js", "a\\b.js", "x.exe", "noext", "c:/x.js", ".js", "a/", ".hidden.js", "a/.git/x.js", "x.wasm"]) {
      expect(isAllowedPath(p), p).toBe(false);
    }
  });

  it("finds the folder beside a page", () => {
    expect(sidecarDir("projects/r/pages/tracker.md")).toBe("projects/r/pages/tracker.smart");
    expect(sidecarDir("tracker.md")).toBe("tracker.smart");
    expect(sidecarDir("notes.txt")).toBeNull();
    expect(sidecarDir("a/.md")).toBeNull();
  });
});

describe("parseBridgeRequest accepts every call", () => {
  const good: unknown[] = [
    { id: 1, kind: "query", args: { tag: "conference", filter: [{ key: "city", op: "is", value: "Oslo" }], sort: [{ key: "date", dir: "desc" }], limit: 10 } },
    { id: 2, kind: "list", args: { project: "research", type: "note" } },
    { id: 3, kind: "list", args: {} },
    { id: 4, kind: "read", args: { id: "n1" } },
    { id: 5, kind: "search", args: { q: "oslo", limit: 5 } },
    { id: 6, kind: "journal", args: { date: "2026-10-22" } },
    { id: 7, kind: "project" },
    { id: 8, kind: "tasks", args: { project: "r", done: false } },
    { id: 9, kind: "board", args: { path: "boards/b.board" } },
    { id: 10, kind: "watch", args: { watchId: "w1", query: { tag: "conference" } } },
    { id: 11, kind: "unwatch", args: { watchId: "w1" } },
    { id: 12, kind: "open", args: { target: "n1" } },
    { id: 13, kind: "theme" },
    { id: 14, kind: "resize", args: { px: 480 } },
    { id: 15, kind: "log", args: { args: ["a", 1, { b: [true, null] }] } },
    { id: 16, kind: "report", args: { kind: "unhandledrejection", message: "boom", source: "smart://p/app.js", line: 12 } },
    { id: 17, kind: "update", args: { id: "n1", props: { city: "Oslo", n: 2, tags: ["a"] } } },
    { id: 18, kind: "addTags", args: { id: "n1", tags: ["a", "b"] } },
    { id: 19, kind: "createNote", args: { title: "T", tags: ["x"], props: { k: "v" }, body: "hi", project: "r" } },
    { id: 20, kind: "append", args: { id: "n1", md: "- more" } },
    { id: 21, kind: "toggleTodo", args: { id: "n1", index: 2 } },
  ];

  it.each(good.map((m) => [(m as { kind: string }).kind, m]))("%s", (_kind, message) => {
    expect(ok(message)).toEqual(message);
  });

  it("takes args null or empty for the calls without arguments", () => {
    expect(ok({ id: 1, kind: "project", args: null })).toEqual({ id: 1, kind: "project" });
    expect(ok({ id: 1, kind: "theme", args: {} })).toEqual({ id: 1, kind: "theme" });
  });

  it("rebuilds the message from the fields it knows", () => {
    const out = ok({ id: 1, kind: "read", args: { id: "n1", sneaky: "x" }, extra: 1 });
    expect(out).toEqual({ id: 1, kind: "read", args: { id: "n1" } });
    const q = ok({ id: 2, kind: "query", args: { tag: "t", filter: [{ key: "k", other: 1 }], sort: [{ key: "k", other: 1 }] } });
    expect(q).toEqual({ id: 2, kind: "query", args: { tag: "t", filter: [{ key: "k" }], sort: [{ key: "k" }] } });
  });

  it("tells reads from writes", () => {
    expect(isWriteCall(ok({ id: 1, kind: "append", args: { id: "n", md: "x" } }))).toBe(true);
    expect(isWriteCall(ok({ id: 1, kind: "read", args: { id: "n" } }))).toBe(false);
    expect(isWriteCall(ok({ id: 1, kind: "watch", args: { watchId: "w", query: { tag: "t" } } }))).toBe(false);
  });
});

describe("parseBridgeRequest refuses what does not fit", () => {
  it("rejects anything that is not a message", () => {
    for (const raw of [null, undefined, "read", 3, [], [{ id: 1, kind: "project" }], new Date()]) refused(raw);
  });

  it("needs a whole-number id", () => {
    for (const id of [undefined, -1, 1.5, "1", 2 ** 32, NaN, Infinity]) refused({ id, kind: "project" });
  });

  it("rejects unknown kinds and gives the name back shortened", () => {
    expect(refused({ id: 1, kind: "eval", args: {} })).toContain("eval");
    expect(refused({ id: 1, kind: "x".repeat(500), args: {} }).length).toBeLessThan(120);
    refused({ id: 1, kind: 5 });
    refused({ id: 1, kind: "toString", args: {} });
    refused({ id: 1, kind: "__proto__", args: {} });
  });

  it("rejects missing, wrong or oversized arguments", () => {
    refused({ id: 1, kind: "read" });
    refused({ id: 1, kind: "read", args: "n1" });
    refused({ id: 1, kind: "read", args: [] });
    refused({ id: 1, kind: "read", args: { id: 3 } });
    refused({ id: 1, kind: "read", args: { id: "" } });
    refused({ id: 1, kind: "read", args: { id: "x".repeat(2000) } });
    refused({ id: 1, kind: "project", args: { x: 1 } });
    refused({ id: 1, kind: "resize", args: { px: "tall" } });
    refused({ id: 1, kind: "resize", args: { px: 0 } });
    refused({ id: 1, kind: "resize", args: { px: 1.5 } });
    refused({ id: 1, kind: "journal", args: { date: "22 Oct 2026" } });
    refused({ id: 1, kind: "toggleTodo", args: { id: "n", index: -1 } });
    refused({ id: 1, kind: "tasks", args: { done: "no" } });
    refused({ id: 1, kind: "append", args: { id: "n", md: "x".repeat(1_000_001) } });
  });

  it("checks queries closely", () => {
    refused({ id: 1, kind: "query", args: {} });
    refused({ id: 1, kind: "query", args: { tag: "t", limit: 0 } });
    refused({ id: 1, kind: "query", args: { tag: "t", limit: MAX_QUERY_LIMIT + 1 } });
    refused({ id: 1, kind: "query", args: { tag: "t", filter: [{ key: "k", op: "matches" }] } });
    refused({ id: 1, kind: "query", args: { tag: "t", filter: "k" } });
    refused({ id: 1, kind: "query", args: { tag: "t", sort: [{ key: "k", dir: "up" }] } });
    refused({ id: 1, kind: "query", args: { tag: "t", filter: Array.from({ length: 21 }, () => ({ key: "k" })) } });
    refused({ id: 1, kind: "watch", args: { watchId: "w" } });
    refused({ id: 1, kind: "watch", args: { watchId: "w", query: { tag: 3 } } });
  });

  it("allows only plain data in props, logs and filter values", () => {
    refused({ id: 1, kind: "update", args: { id: "n", props: [] } });
    refused({ id: 1, kind: "update", args: { id: "n", props: { f: () => 1 } } });
    refused({ id: 1, kind: "update", args: { id: "n", props: { n: NaN } } });
    refused({ id: 1, kind: "update", args: { id: "n", props: JSON.parse('{"__proto__": {"x": 1}}') } });
    refused({ id: 1, kind: "update", args: { id: "n", props: { d: new Date() } } });
    refused({ id: 1, kind: "log", args: { args: [undefined] } });
    refused({ id: 1, kind: "log", args: { args: Array.from({ length: 21 }, () => 1) } });
    refused({ id: 1, kind: "query", args: { tag: "t", filter: [{ key: "k", value: () => 1 }] } });
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = [deep];
    refused({ id: 1, kind: "log", args: { args: [deep] } });
  });

  it("caps how much data one message may hold, and stops walking at the cap", () => {
    // One list of a hundred thousand items, in props, a filter value or a log line.
    const huge = Array.from({ length: 100_000 }, (_, i) => i);
    refused({ id: 1, kind: "update", args: { id: "n", props: { list: huge } } });
    refused({ id: 1, kind: "query", args: { tag: "t", filter: [{ key: "k", op: "is", value: huge }] } });
    refused({ id: 1, kind: "log", args: { args: [huge] } });
    // Many lists that are each small, but together over the cap.
    const wide = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, Array.from({ length: 150 }, () => 1)]));
    refused({ id: 1, kind: "update", args: { id: "n", props: wide } });
    // A message of ordinary size is still fine.
    ok({ id: 1, kind: "update", args: { id: "n", props: { tags: Array.from({ length: 150 }, () => "a"), n: 1 } } });
    // The walk stops at the cap: it does not visit a huge list's items one by one.
    let visited = 0;
    const counted = new Proxy(huge, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) visited++;
        return Reflect.get(target, key, receiver);
      },
    });
    parseBridgeRequest({ id: 1, kind: "update", args: { id: "n", props: { list: counted } } });
    expect(visited).toBeLessThan(5_000);
  });

  it("checks tags and reports", () => {
    refused({ id: 1, kind: "addTags", args: { id: "n", tags: "a" } });
    refused({ id: 1, kind: "addTags", args: { id: "n", tags: ["a", 2] } });
    refused({ id: 1, kind: "addTags", args: { id: "n", tags: [""] } });
    refused({ id: 1, kind: "createNote", args: { title: "T", tags: "x" } });
    refused({ id: 1, kind: "report", args: { kind: "warn", message: "m" } });
    refused({ id: 1, kind: "report", args: { kind: "error", message: "m", line: -1 } });
    refused({ id: 1, kind: "report", args: { kind: "error" } });
  });

  it("finds the id of a refused message so it can be answered", () => {
    expect(requestIdOf({ id: 7, kind: "eval" })).toBe(7);
    expect(requestIdOf({ id: "7" })).toBeNull();
    expect(requestIdOf({ id: -1 })).toBeNull();
    expect(requestIdOf(null)).toBeNull();
    expect(requestIdOf("x")).toBeNull();
  });
});
