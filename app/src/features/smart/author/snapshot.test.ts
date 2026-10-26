// What a page read is kept for a saved copy: the reads and watches the bridge
// answered, never a write, bounded.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE, rig, settle } from "../test-support/rig";
import { request } from "../test-support/fake-frame";
import { forgetSnapshot, keyOf, MAX_ENTRIES, MAX_PAGES, record, recorderFor, snapshotOf, stable, wasShown } from "./snapshot";

beforeEach(() => {
  vi.useFakeTimers();
  forgetSnapshot();
});
afterEach(() => vi.useRealTimers());

describe("keys", () => {
  it("are the same for the same request however its keys were written", () => {
    expect(stable({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stable({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(keyOf("query", { tag: "t", limit: 5 })).toBe(keyOf("query", { limit: 5, tag: "t" }));
    expect(keyOf("project", undefined)).toBe("project|");
  });
});

describe("the book", () => {
  it("keeps the latest answer to a request, per page", () => {
    record("a.md", "query", { tag: "t" }, [1]);
    record("a.md", "query", { tag: "t" }, [1, 2]);
    record("b.md", "query", { tag: "t" }, [9]);
    expect(snapshotOf("a.md").map((e) => e.value)).toEqual([[1, 2]]);
    expect(snapshotOf("b.md").map((e) => e.value)).toEqual([[9]]);
    forgetSnapshot("a.md");
    expect(snapshotOf("a.md")).toEqual([]);
  });

  it("drops the oldest requests past its limits", () => {
    for (let i = 0; i < MAX_ENTRIES + 20; i += 1) record("p.md", "read", { id: `n${i}` }, { i });
    const kept = snapshotOf("p.md");
    expect(kept).toHaveLength(MAX_ENTRIES);
    expect(kept.at(-1)?.args).toEqual({ id: `n${MAX_ENTRIES + 19}` });
    forgetSnapshot();
    record("q.md", "read", { id: "old" }, "x".repeat(3 * 1024 * 1024));
    record("q.md", "read", { id: "new" }, "y".repeat(3 * 1024 * 1024));
    expect(snapshotOf("q.md").map((e) => (e.args as { id: string }).id)).toEqual(["new"]);
  });

  it("keeps the answers of a few pages only, the one used longest ago going first, and not an answer too big for a copy", () => {
    for (let i = 0; i < MAX_PAGES + 3; i += 1) record(`p${i}.md`, "query", { tag: "t" }, [i]);
    expect(snapshotOf("p0.md")).toEqual([]);
    expect(wasShown("p0.md")).toBe(false);
    expect(snapshotOf(`p${MAX_PAGES + 2}.md`)).toHaveLength(1);
    // Using a page again makes it the newest.
    record("p3.md", "query", { tag: "u" }, [1]);
    record("p-new.md", "query", { tag: "t" }, [1]);
    expect(snapshotOf("p3.md")).toHaveLength(2);
    expect(snapshotOf("p4.md")).toEqual([]);
    record("big.md", "read", { id: "x" }, "z".repeat(5 * 1024 * 1024));
    expect(snapshotOf("big.md")).toEqual([]);
  });

  it("knows which pages have shown a frame", () => {
    expect(wasShown("a.md")).toBe(false);
    recorderFor("a.md");
    expect(wasShown("a.md")).toBe(true);
  });
});

describe("recording from the bridge", () => {
  it("keeps what the page read and what it watches, and nothing it wrote", async () => {
    const r = rig({ record: recorderFor(PAGE) });
    r.backend.answer = (call) => (call.kind === "query" ? [{ id: "n1" }] : { ok: true });
    r.say(request(1, "query", { tag: "t" }));
    r.say(request(2, "watch", { watchId: "w1", query: { tag: "w" } }));
    r.say(request(3, "update", { id: "n1", props: { a: 1 } }));
    r.say(request(4, "createNote", { title: "New" }));
    await settle();
    const kept = snapshotOf(PAGE);
    expect(kept.map((e) => [e.kind, e.args])).toEqual([
      ["query", { tag: "t" }],
      ["query", { tag: "w" }],
    ]);
    expect(kept.every((e) => !["update", "createNote", "append", "addTags", "toggleTodo"].includes(e.kind))).toBe(true);
  });

  it("answers the page all the same when the recorder fails", async () => {
    const r = rig({
      record: () => {
        throw new Error("no room");
      },
    });
    r.backend.answer = () => [{ id: "n1" }];
    r.say(request(1, "query", { tag: "t" }));
    await settle();
    expect(r.answers().map((a) => [a.id, a.ok])).toEqual([[1, true]]);
  });

  it("follows a watch when the vault changes", async () => {
    const r = rig({ record: recorderFor(PAGE) });
    let rows = [{ id: "n1" }];
    r.backend.answer = () => rows;
    r.say(request(1, "watch", { watchId: "w1", query: { tag: "w" } }));
    await settle();
    rows = [{ id: "n1" }, { id: "n2" }];
    r.change();
    await vi.advanceTimersByTimeAsync(400);
    expect(snapshotOf(PAGE).map((e) => e.value)).toEqual([[{ id: "n1" }, { id: "n2" }]]);
  });
});
