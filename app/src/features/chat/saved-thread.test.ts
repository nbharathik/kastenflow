// A thread as it is kept between runs: the window's copy that `chat_save_ui`
// stores and `chat_load` gives back, how it is brought back (a thread that was
// working, one that stopped short), and how often it is written.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedThread } from "./agent-types";
import { SAVE_LIMIT, Persister, blobOf, reconcile, restore, savedOf } from "./saved-thread";
import { applyEvent, newThread, startTurn, turnStarted, type Answer, type Thread } from "./thread";
import type { ChatEvent } from "./types";

const TURN = { chat: "c1", session: "s1", turn: "t1" };
const event = (e: Partial<ChatEvent> & Pick<ChatEvent, "kind">): ChatEvent => ({ chat: "c1", turn: "t1", ...e });

/** A thread with one question answered in full. */
function finished(): Thread {
  let t: Thread = { ...newThread({ context: [{ kind: "note", label: "Plan", ref: ["library/plan.md"], origin: "auto" }] }), id: "c1", title: "Tidy the deck", follow: false, direct: true };
  t = turnStarted(startTurn(t, "Tidy up the deck", "Claude", "model-small"), TURN);
  for (const e of [
    event({ kind: "text", seq: 1, text: "On it. " }),
    event({ kind: "tool", seq: 2, tool: { id: "k1", name: "edit_deck", input: { slide: 2, text: "a".repeat(50) } } }),
    event({ kind: "toolResult", seq: 3, result: { id: "k1", ok: true, summary: "Edited slide 2", paths: ["library/talk.deck"], staged: true } }),
    event({ kind: "plan", seq: 4, plan: [{ id: "1", text: "Fix titles", status: "doing" }] }),
    event({ kind: "done", seq: 5 }),
  ])
    t = applyEvent(t, e);
  return { ...t, changes: { id: "set-1", count: 1, paths: ["library/talk.deck"] }, changed: true };
}

const loaded = (over: Partial<LoadedThread> = {}, ui: unknown = null): LoadedThread => ({ ui, status: "idle", seq: 5, plan: [], title: "Tidy the deck", provider: "Claude", model: "model-small", queued: [], ...over });
const answer = (t: Thread) => t.messages.at(-1) as Answer;

describe("what is kept of a thread", () => {
  it("holds its messages, chips, name, settings, plan and place in the event count, and leaves out what is only of this moment", () => {
    const t = { ...finished(), streaming: true, stopping: true, round: 4, queued: ["later"] };
    const blob = savedOf({ ...t, messages: t.messages.map((m) => (m.role === "assistant" ? { ...m, retry: "Connection dropped, trying again (2 of 4)" } : { ...m, attachments: [{ id: "a1", name: "n.md", kind: "text", label: "n.md · 8 B", thumb: "blob:abc" }] })) });
    const json = JSON.parse(JSON.stringify(blob)) as Record<string, unknown>;
    expect(json).toMatchObject({ v: 1, id: "c1", title: "Tidy the deck", follow: false, direct: true, seq: 5, session: "s1", changed: true, changes: { id: "set-1" } });
    expect(JSON.stringify(json)).not.toMatch(/blob:abc|Connection dropped|"stopping"|"round"/);
    expect((json["messages"] as unknown[]).length).toBe(2);
    expect(json["plan"]).toEqual([{ id: "1", text: "Fix titles", status: "doing" }]);
  });

  it("comes back as it was", () => {
    const original = finished();
    const back = restore("c1", loaded({}, JSON.parse(JSON.stringify(savedOf(original)))));
    expect(back).toMatchObject({ id: "c1", title: "Tidy the deck", follow: false, direct: true, provider: "Claude", model: "model-small", session: "s1", changed: true, seq: 5, streaming: false });
    expect(back.messages).toEqual(original.messages);
    expect(back.context).toEqual(original.context);
    expect(back.changes).toEqual(original.changes);
  });

  it("keeps the chip of a LaTeX file, which it names by the file's path", () => {
    const chips = [
      { kind: "latex" as const, label: "main.tex", ref: ["projects/p/latex/paper/main.tex"], origin: "auto" as const },
      { kind: "selection" as const, label: "Selection · “\\begin{align}” · main.tex", ref: [], origin: "added" as const, selection: { source: { kind: "latex" as const, path: "projects/p/latex/paper/main.tex" }, text: "\\begin{align}", range: { from: 10, to: 23 }, pinned: true } },
    ];
    const original = { ...finished(), context: chips };
    const back = restore("c1", loaded({}, JSON.parse(JSON.stringify(savedOf(original)))));
    expect(back.context).toEqual(chips);
  });

  it("is a bare thread when nothing was saved but the backend knows of it", () => {
    const t = restore("c9", loaded({ queued: ["wait"], plan: [{ id: "1", text: "x", status: "todo" }], title: "From the first line", provider: "Local", model: "m" }));
    expect(t).toMatchObject({ id: "c9", provider: "Local", model: "m", messages: [], seq: 5, queued: ["wait"], plan: [{ id: "1", text: "x", status: "todo" }] });
  });

  it("takes the plan and the waiting messages from the backend, which has the later word", () => {
    const blob = JSON.parse(JSON.stringify(savedOf({ ...finished(), plan: [{ id: "1", text: "Old", status: "todo" }], queued: ["old"] })));
    const t = restore("c1", loaded({ plan: [{ id: "1", text: "New", status: "done" }], queued: [] }, blob));
    expect(t.plan).toEqual([{ id: "1", text: "New", status: "done" }]);
    expect(t.queued).toBeUndefined();
  });

  it("is not thrown by a blob that is not what was written", () => {
    expect(() => restore("c2", loaded({}, "nonsense"))).not.toThrow();
    const odd = { v: 1, messages: [null, 3, { role: "user" }, { role: "user", id: "m", text: "Hi", context: "x" }, { role: "assistant", id: "a", parts: "no", status: "weird" }], context: "x", settings: 4 };
    const t = restore("c2", loaded({}, odd));
    expect(t.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t.messages[0]).toMatchObject({ text: "Hi", context: [] });
    expect(answer(t)).toMatchObject({ parts: [], status: "done" });
    expect(t.context).toEqual([]);
  });
});

describe("a thread that was working", () => {
  const working = () => {
    const t = startTurn({ ...newThread(), id: "c1" }, "Long task", "Claude", "m");
    return applyEvent(turnStarted(t, TURN), event({ kind: "text", seq: 1, text: "Started. " }));
  };

  it("is still working when the backend says so, to be caught up from where the copy stopped", () => {
    const t = restore("c1", loaded({ status: "running", seq: 1 }, JSON.parse(JSON.stringify(savedOf(working())))));
    expect(t).toMatchObject({ streaming: true, seq: 1 });
    expect(answer(t).status).toBe("streaming");
  });

  it("is caught up by the events it missed", () => {
    const t = restore("c1", loaded({ status: "running", seq: 1 }, JSON.parse(JSON.stringify(savedOf(working())))));
    const caught = [event({ kind: "text", seq: 1, text: "Started. " }), event({ kind: "text", seq: 2, text: "Going on." }), event({ kind: "done", seq: 3 })].reduce(applyEvent, t);
    expect(answer(caught).parts).toEqual([{ kind: "text", text: "Started. Going on." }]);
    expect(caught.streaming).toBe(false);
  });

  it("is told apart by what the backend says once the events are in", () => {
    const base = restore("c1", loaded({ status: "interrupted", seq: 1 }, JSON.parse(JSON.stringify(savedOf(working())))));
    const interrupted = reconcile(base, "interrupted");
    expect(answer(interrupted).status).toBe("paused");
    expect(interrupted).toMatchObject({ streaming: false, pause: { reason: "interrupted" } });
    expect(interrupted.pause!.detail).toMatch(/closed|interrupted/i);
    expect(answer(reconcile(base, "idle")).status).toBe("done");
    expect(answer(reconcile(base, "error"))).toMatchObject({ status: "error", error: expect.stringMatching(/stopped/i) });
    expect(reconcile(base, "paused").pause).toMatchObject({ reason: expect.any(String), detail: expect.stringMatching(/paused/i) });
    // Working still: nothing to settle.
    expect(reconcile(restore("c1", loaded({ status: "running" }, JSON.parse(JSON.stringify(savedOf(working()))))), "running")).toMatchObject({ streaming: true });
  });

  it("keeps the pause it was saved with", () => {
    const paused = [event({ kind: "paused", seq: 2, reason: "calls", detail: "Paused after 250 tool calls" })].reduce(applyEvent, working());
    const t = reconcile(restore("c1", loaded({ status: "paused", seq: 2 }, JSON.parse(JSON.stringify(savedOf(paused))))), "paused");
    expect(t.pause).toEqual({ reason: "calls", detail: "Paused after 250 tool calls" });
    expect(answer(t).status).toBe("paused");
  });
});

describe("a thread too big for the blob", () => {
  it("loses the inputs of its tool calls first, then its oldest messages, and always fits", () => {
    let t: Thread = { ...newThread(), id: "big" };
    for (let i = 0; i < 6; i++) {
      t = turnStarted(startTurn(t, `Question ${i}`, "Claude", "m"), { chat: "big", session: "s", turn: `t${i}` });
      for (const e of [
        { chat: "big", turn: `t${i}`, kind: "tool" as const, tool: { id: `k${i}`, name: "edit_deck", input: { text: "x".repeat(400_000) } } },
        { chat: "big", turn: `t${i}`, kind: "text" as const, text: `Answer ${i}. ` + "y".repeat(1_000_000) },
        { chat: "big", turn: `t${i}`, kind: "done" as const },
      ])
        t = applyEvent(t, e);
    }
    expect(JSON.stringify(savedOf(t)).length).toBeGreaterThan(SAVE_LIMIT);
    // The inputs alone are not enough here, so the oldest messages go too.
    const blob = JSON.stringify(blobOf(t));
    expect(blob.length).toBeLessThanOrEqual(SAVE_LIMIT);
    // The newest is what is kept. (Booleans, so a failure does not print megabytes.)
    expect(blob.includes("Question 5")).toBe(true);
    expect(blob.includes("Question 0")).toBe(false);
    expect(blob.includes("xxxxxxxxxx")).toBe(false);
  });

  it("loses only the inputs when that is enough", () => {
    let t: Thread = { ...newThread(), id: "mid" };
    for (let i = 0; i < 9; i++) {
      t = turnStarted(startTurn(t, `Question ${i}`, "Claude", "m"), { chat: "mid", session: "s", turn: `t${i}` });
      for (const e of [
        { chat: "mid", turn: `t${i}`, kind: "tool" as const, tool: { id: `k${i}`, name: "edit_deck", input: { text: "x".repeat(600_000) } } },
        { chat: "mid", turn: `t${i}`, kind: "done" as const },
      ])
        t = applyEvent(t, e);
    }
    expect(JSON.stringify(savedOf(t)).length).toBeGreaterThan(SAVE_LIMIT);
    const blob = blobOf(t);
    expect(blob.messages).toHaveLength(18);
    expect(JSON.stringify(blob).length).toBeLessThanOrEqual(SAVE_LIMIT);
  });

  it("is left alone when it fits", () => {
    const t = finished();
    expect(blobOf(t)).toEqual(savedOf(t));
  });
});

describe("how often a thread is written", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const saves: string[] = [];
    const persister = new Persister(async (id) => void saves.push(id), { delay: 1500, maxWait: 10_000 });
    return { persister, saves };
  };

  it("waits for the typing to settle, then writes once", async () => {
    const { persister, saves } = make();
    persister.mark("a");
    await vi.advanceTimersByTimeAsync(1000);
    persister.mark("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(saves).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saves).toEqual(["a"]);
  });

  it("writes every ten seconds at most while it keeps changing", async () => {
    const { persister, saves } = make();
    for (let ms = 0; ms < 25_000; ms += 100) {
      persister.mark("a");
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(saves.length).toBeGreaterThanOrEqual(2);
    expect(saves.length).toBeLessThanOrEqual(3);
  });

  it("writes at once when asked, for one thread or all", async () => {
    const { persister, saves } = make();
    persister.mark("a");
    persister.mark("b");
    await persister.flush("a");
    expect(saves).toEqual(["a"]);
    await persister.flush();
    expect(saves).toEqual(["a", "b"]);
    await persister.flush();
    expect(saves).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toEqual(["a", "b"]);
  });

  it("keeps threads apart and survives a write that fails", async () => {
    const calls: string[] = [];
    let fail = true;
    const persister = new Persister(
      async (id) => {
        calls.push(id);
        if (fail) throw new Error("disk full");
      },
      { delay: 100, maxWait: 1000 },
    );
    persister.mark("a");
    persister.mark("b");
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.sort()).toEqual(["a", "b"]);
    fail = false;
    persister.mark("a");
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.filter((c) => c === "a")).toHaveLength(2);
  });

  it("does not write over a write in flight: what changed meanwhile goes after it", async () => {
    let release: () => void = () => {};
    const started: string[] = [];
    let open = 0;
    let most = 0;
    const persister = new Persister(
      async (id) => {
        started.push(id);
        open++;
        most = Math.max(most, open);
        await new Promise<void>((done) => (release = done));
        open--;
      },
      { delay: 100, maxWait: 1000 },
    );
    persister.mark("a");
    await vi.advanceTimersByTimeAsync(150);
    expect(started).toEqual(["a"]);
    persister.mark("a");
    await vi.advanceTimersByTimeAsync(500);
    expect(started).toEqual(["a"]);
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(started).toEqual(["a", "a"]);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(most).toBe(1);
  });

  it("writes nothing once it is disposed", async () => {
    const { persister, saves } = make();
    persister.mark("a");
    persister.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toEqual([]);
  });
});
