import { beforeEach, describe, expect, it } from "vitest";

import { newThread, threadStatus, type Answer, type Thread } from "./thread";
import { STATUS_WORDS, unreadCount, useUnread, workingCount } from "./unread";

const state = () => useUnread.getState();

beforeEach(() => useUnread.setState({ unseen: {}, viewing: {} }));

describe("what finished while you were elsewhere", () => {
  it("counts a thread that is done, paused or failed while it is not in view", () => {
    state().note("a", "done");
    state().note("b", "needs");
    state().note("c", "failed");
    expect(unreadCount(state())).toBe(3);
    expect(state().unseen).toEqual({ a: "done", b: "needs", c: "failed" });
  });

  it("counts a thread once, with its most pressing outcome", () => {
    state().note("a", "done");
    state().note("a", "failed");
    state().note("a", "done");
    expect(state().unseen).toEqual({ a: "failed" });
    expect(unreadCount(state())).toBe(1);
  });

  it("does not count a thread that is in view", () => {
    const leave = state().view("a");
    state().note("a", "done");
    expect(unreadCount(state())).toBe(0);
    leave();
    state().note("a", "done");
    expect(unreadCount(state())).toBe(1);
  });

  it("clears a thread when it is opened", () => {
    state().note("a", "needs");
    state().note("b", "done");
    const leave = state().view("a");
    expect(state().unseen).toEqual({ b: "done" });
    leave();
    // Leaving does not bring it back: it was seen.
    expect(state().unseen).toEqual({ b: "done" });
  });

  it("keeps a thread in view until every place showing it has let go", () => {
    const dock = state().view("a");
    const view = state().view("a");
    dock();
    state().note("a", "done");
    expect(unreadCount(state())).toBe(0);
    view();
    state().note("a", "done");
    expect(unreadCount(state())).toBe(1);
  });

  it("forgets a thread that was removed", () => {
    state().note("a", "done");
    state().forget("a");
    expect(unreadCount(state())).toBe(0);
  });

  it("lets go of a place twice without going negative", () => {
    const leave = state().view("a");
    leave();
    leave();
    expect(state().viewing["a"] ?? 0).toBe(0);
  });
});

const answer = (status: Answer["status"]): Answer => ({ id: "m", role: "assistant", turn: "t", provider: "p", model: "m", parts: [], status, error: null, pinned: null });
const with_ = (over: Partial<Thread>): Thread => ({ ...newThread(), ...over });

describe("a thread's status", () => {
  it("is Working while it answers, Paused or Interrupted when it stopped short, Done or Failed after", () => {
    expect(threadStatus(with_({ streaming: true, messages: [answer("streaming")] }))).toBe("working");
    expect(threadStatus(with_({ pause: { reason: "rounds", detail: "Paused after 80 steps" }, messages: [answer("done")] }))).toBe("paused");
    expect(threadStatus(with_({ pause: { reason: "interrupted", detail: "The app closed" }, messages: [answer("done")] }))).toBe("interrupted");
    expect(threadStatus(with_({ messages: [answer("error")] }))).toBe("failed");
    expect(threadStatus(with_({ messages: [{ id: "q", role: "user", text: "Hi", context: [] }, answer("done")] }))).toBe("done");
    expect(threadStatus(with_({ messages: [answer("stopped")] }))).toBe("idle");
    expect(threadStatus(newThread())).toBe("idle");
  });

  it("has words for the list", () => {
    expect(STATUS_WORDS).toEqual({ working: "Working", waiting: "Waiting", paused: "Paused", interrupted: "Interrupted", done: "Done", failed: "Failed", idle: "" });
  });
});

describe("how many threads work", () => {
  it("counts the ones that stream", () => {
    const threads = { a: with_({ streaming: true }), b: with_({}), c: with_({ streaming: true }) };
    expect(workingCount({ threads })).toBe(2);
    expect(workingCount({ threads: {} })).toBe(0);
  });

  it("is kept for the window's button, which reads it without loading the chat", () => {
    state().setWorking(2);
    expect(state().working).toBe(2);
    state().setWorking(0);
    expect(state().working).toBe(0);
  });
});
