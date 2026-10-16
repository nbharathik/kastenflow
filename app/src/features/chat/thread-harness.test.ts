// What the agent harness's events do to a thread: the plan, a pause and
// carrying on, a message queued while the model works, the step it is on, a
// dropped connection tried again, and a window that was away catching up.

import { describe, expect, it } from "vitest";

import { pausedOf, planOf, queuedOf, roundOf, retryOf } from "./thread-events";
import { applyEvent, continued, endTurn, newThread, startTurn, turnStarted, type Answer, type Thread } from "./thread";
import type { ChatEvent } from "./types";

const TURN = { chat: "c", session: "s", turn: "t1" };

function running(): Thread {
  const t = startTurn({ ...newThread(), id: "c" }, "Tidy up the deck", "Claude", "m");
  return turnStarted(t, TURN);
}
const event = (e: Partial<ChatEvent> & Pick<ChatEvent, "kind">): ChatEvent => ({ chat: "c", turn: "t1", ...e });
const answer = (t: Thread) => t.messages.at(-1) as Answer;
const fold = (t: Thread, ...events: ChatEvent[]) => events.reduce(applyEvent, t);

describe("reading the harness's events", () => {
  it("reads a plan from its items, in either shape", () => {
    const items = [
      { id: "1", text: "Read the deck", status: "done" },
      { id: "2", text: "Fix the titles", status: "doing" },
      { id: "3", text: "Lint", status: "todo" },
    ];
    expect(planOf({ items })).toEqual(items);
    expect(planOf(items)).toEqual(items);
    expect(planOf({ items: [{ id: "1", text: "x", status: "weird" }, { text: "no id", status: "todo" }, null, 4] })).toEqual([
      { id: "1", text: "x", status: "todo" },
      { id: "2", text: "no id", status: "todo" },
    ]);
    expect(planOf(undefined)).toBeNull();
    expect(planOf("plan")).toBeNull();
    expect(planOf({})).toBeNull();
  });

  it("reads why a turn paused, with a sentence even when none came", () => {
    expect(pausedOf(event({ kind: "paused", reason: "rounds", detail: "Paused after 80 steps" }))).toEqual({ reason: "rounds", detail: "Paused after 80 steps" });
    expect(pausedOf(event({ kind: "paused", reason: "loop" }))).toMatchObject({ reason: "loop" });
    expect(pausedOf(event({ kind: "paused", reason: "loop" })).detail).toMatch(/repeating/i);
    expect(pausedOf(event({ kind: "paused", reason: "nonsense", detail: "" })).reason).toBe("interrupted");
    expect(pausedOf(event({ kind: "paused" })).reason).toBe("interrupted");
  });

  it("reads a queued message and whether the turn took it up", () => {
    expect(queuedOf(event({ kind: "queued", text: " Also the footer ", delivered: false }))).toEqual({ text: "Also the footer", delivered: false });
    expect(queuedOf(event({ kind: "queued", text: "Also the footer", delivered: true }))).toEqual({ text: "Also the footer", delivered: true });
    expect(queuedOf(event({ kind: "queued", text: "Also the footer" }))!.delivered).toBe(false);
    expect(queuedOf(event({ kind: "queued", text: "  " }))).toBeNull();
  });

  it("reads a step number and a retry line", () => {
    expect(roundOf(event({ kind: "round", n: 7, calls: 12 }))).toBe(7);
    expect(roundOf(event({ kind: "round" }))).toBeNull();
    expect(retryOf(event({ kind: "notice", code: "retry", text: "Connection dropped, trying again (2 of 4)" }))).toBe("Connection dropped, trying again (2 of 4)");
    expect(retryOf(event({ kind: "notice", text: "A setting was left out" }))).toBeNull();
  });
});

describe("the plan", () => {
  it("is the thread's, replaced whole by each update, and an empty one clears it", () => {
    const one = fold(running(), event({ kind: "plan", plan: [{ id: "1", text: "Read", status: "doing" }] }));
    expect(one.plan).toEqual([{ id: "1", text: "Read", status: "doing" }]);
    const two = fold(one, event({ kind: "plan", plan: [{ id: "1", text: "Read", status: "done" }, { id: "2", text: "Fix", status: "doing" }] }));
    expect(two.plan?.map((p) => p.status)).toEqual(["done", "doing"]);
    expect(applyEvent(two, event({ kind: "plan", plan: "garbage" })).plan).toEqual(two.plan);
    expect(applyEvent(two, event({ kind: "plan", plan: [] })).plan).toBeUndefined();
  });
});

describe("a pause", () => {
  it("ends the answer calmly, not as an error", () => {
    const t = fold(running(), event({ kind: "text", text: "Working on it" }), event({ kind: "paused", reason: "rounds", detail: "Paused after 80 steps" }));
    expect(answer(t)).toMatchObject({ status: "paused", error: null });
    expect(t).toMatchObject({ streaming: false, pause: { reason: "rounds", detail: "Paused after 80 steps" } });
  });

  it("goes on in place when continued: the same answer streams again and the pause is gone", () => {
    const paused = fold(running(), event({ kind: "text", text: "Part one. " }), event({ kind: "paused", reason: "calls", detail: "Paused after 250 tool calls" }));
    const t = continued(paused);
    expect(t).toMatchObject({ streaming: true, pause: undefined });
    expect(t.messages).toHaveLength(paused.messages.length);
    expect(answer(t)).toMatchObject({ status: "streaming", error: null });
    // Its events find it again, under a turn the backend names now or the one it had.
    const more = fold(turnStarted(t, { ...TURN, turn: "t2" }), event({ kind: "text", turn: "t2", text: "Part two." }), event({ kind: "done", turn: "t2" }));
    expect(answer(more).parts).toEqual([{ kind: "text", text: "Part one. Part two." }]);
    expect(answer(more).status).toBe("done");
  });

  it("cannot be continued when it is not paused", () => {
    const t = running();
    expect(continued(t)).toBe(t);
  });

  it("is over when a new question is asked", () => {
    const paused = fold(running(), event({ kind: "paused", reason: "minutes", detail: "Paused after 30 minutes" }));
    const next = startTurn(paused, "Something else", "Claude", "m");
    expect(next.pause).toBeUndefined();
    expect(next.streaming).toBe(true);
    expect(endTurn(next, "stopped").streaming).toBe(false);
  });
});

describe("a message sent while the model works", () => {
  it("waits as a pending bubble, once, until the turn takes it up", () => {
    let t = fold(running(), event({ kind: "text", text: "Looking" }));
    t = applyEvent(t, event({ kind: "queued", text: "Also fix the footer", delivered: false }));
    expect(t.queued).toEqual(["Also fix the footer"]);
    // The same message twice (this event after the command's answer) is one.
    expect(applyEvent(t, event({ kind: "queued", text: "Also fix the footer", delivered: false })).queued).toEqual(["Also fix the footer"]);
    t = applyEvent(t, event({ kind: "queued", text: "Also fix the footer", delivered: true }));
    expect(t.queued).toBeUndefined();
    expect(answer(t).parts).toEqual([
      { kind: "text", text: "Looking" },
      { kind: "steer", text: "Also fix the footer" },
    ]);
    // What the model says next is a new piece of text after it.
    t = applyEvent(t, event({ kind: "text", text: "Footer too." }));
    expect(answer(t).parts.map((p) => p.kind)).toEqual(["text", "steer", "text"]);
  });

  it("is dropped by a stop, and stays through a pause or a failure to be taken up when it goes on", () => {
    const waiting = () => applyEvent(running(), event({ kind: "queued", text: "Later", delivered: false }));
    expect(applyEvent(waiting(), event({ kind: "done", stopped: true })).queued).toBeUndefined();
    expect(applyEvent(waiting(), event({ kind: "paused", reason: "calls" })).queued).toEqual(["Later"]);
    expect(applyEvent(waiting(), event({ kind: "error", error: "The server went away" })).queued).toEqual(["Later"]);
    expect(applyEvent(waiting(), event({ kind: "done" })).queued).toEqual(["Later"]);
    expect(endTurn(waiting(), "stopped").queued).toBeUndefined();
    expect(endTurn(waiting(), "error", "x").queued).toEqual(["Later"]);
  });

  it("keeps the others waiting when one is taken up", () => {
    let t = running();
    t = applyEvent(t, event({ kind: "queued", text: "One", delivered: false }));
    t = applyEvent(t, event({ kind: "queued", text: "Two", delivered: false }));
    t = applyEvent(t, event({ kind: "queued", text: "One", delivered: true }));
    expect(t.queued).toEqual(["Two"]);
  });
});

describe("the step it is on", () => {
  it("is kept quietly while it works and gone when it ends", () => {
    const t = fold(running(), event({ kind: "round", n: 7, calls: 12 }));
    expect(t.round).toBe(7);
    expect(fold(t, event({ kind: "done" })).round).toBeUndefined();
  });
});

describe("a dropped connection", () => {
  it("shows one line that clears once the answer goes on", () => {
    const t = fold(running(), event({ kind: "notice", code: "retry", text: "Connection dropped, trying again (2 of 4)" }));
    expect(answer(t).retry).toBe("Connection dropped, trying again (2 of 4)");
    expect(answer(t).notice).toBeUndefined();
    const later = applyEvent(t, event({ kind: "text", text: "Back." }));
    expect(answer(later).retry).toBeUndefined();
  });

  it("leaves other notices as they were", () => {
    const t = fold(running(), event({ kind: "notice", text: "This model doesn't take a reasoning effort." }));
    expect(answer(t).notice).toBe("This model doesn't take a reasoning effort.");
    expect(answer(t).retry).toBeUndefined();
  });
});

describe("catching up", () => {
  it("ignores an event it has taken in already, and remembers how far it got", () => {
    let t = fold(running(), event({ kind: "text", seq: 1, text: "One " }), event({ kind: "text", seq: 2, text: "two " }));
    expect(t.seq).toBe(2);
    t = applyEvent(t, event({ kind: "text", seq: 2, text: "two " }));
    t = applyEvent(t, event({ kind: "text", seq: 1, text: "One " }));
    expect(answer(t).parts).toEqual([{ kind: "text", text: "One two " }]);
    t = applyEvent(t, event({ kind: "text", seq: 3, text: "three" }));
    expect(answer(t).parts).toEqual([{ kind: "text", text: "One two three" }]);
    expect(t.seq).toBe(3);
  });

  it("takes events without a number as they come", () => {
    const t = fold(running(), event({ kind: "text", text: "a" }), event({ kind: "text", text: "b" }));
    expect(answer(t).parts).toEqual([{ kind: "text", text: "ab" }]);
    expect(t.seq).toBeUndefined();
  });
});
