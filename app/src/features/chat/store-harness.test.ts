// The store with the agent harness: sending while it works, carrying on a
// pause, attachments on a message, what finished out of sight, and threads
// that outlive the window (saving, a reload, a chat the window did not know).

import { beforeEach, describe, expect, it } from "vitest";

import type { LoadedThread, ThreadSummary } from "./agent-types";
import { flushSaves, flushStream, useChat } from "./store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "./test-kit";
import type { Answer, SentAttachment } from "./thread";
import type { ChatEvent } from "./types";
import { useUnread } from "./unread";

let chat: Scripted;
const store = () => useChat.getState();
const thread = (id: string) => store().threads[id]!;
const last = (id: string) => thread(id).messages.at(-1) as Answer;
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

beforeEach(async () => {
  localStorage.clear();
  useUnread.setState({ unseen: {}, viewing: {} });
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  await store().loadProviders();
});

const ev = (e: Partial<ChatEvent> & Pick<ChatEvent, "chat" | "kind">): ChatEvent => ({ turn: "turn-1", ...e });
const note: SentAttachment = { id: "att-1", name: "notes.md", kind: "text", label: "notes.md · 8 B" };

describe("sending while it works", () => {
  it("queues the message: it is sent, waits as pending, and adds no question or answer yet", async () => {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    chat.queueNext();
    expect(await store().send(id, "  Also the footer ")).toBe(true);
    expect(chat.requests.map((r) => r.text)).toEqual(["Tidy the deck", "Also the footer"]);
    expect(thread(id).messages).toHaveLength(2);
    expect(thread(id).queued).toEqual(["Also the footer"]);
    // The turn takes it up at its next step.
    chat.emit(ev({ chat: id, kind: "queued", text: "Also the footer", delivered: true }));
    expect(thread(id).queued).toBeUndefined();
    expect(last(id).parts).toEqual([{ kind: "steer", text: "Also the footer" }]);
  });

  it("starts a turn of its own when the backend had finished meanwhile", async () => {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    // The turn ended on the backend, and the window has not heard yet.
    expect(await store().send(id, "Now the footer")).toBe(true);
    expect(thread(id).messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(last(id)).toMatchObject({ status: "streaming", turn: "turn-2" });
    expect(thread(id).queued).toBeUndefined();
  });

  it("does not send while Stop is being waited for, or without text", async () => {
    const id = store().start();
    await store().send(id, "Write a long essay");
    await store().stop(id);
    expect(await store().send(id, "More")).toBe(false);
    expect(await store().send(id, "   ")).toBe(false);
    expect(chat.requests).toHaveLength(1);
  });

  it("leaves the turn running when a queued message cannot be sent", async () => {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    chat.failNext("The chat is busy");
    expect(await store().send(id, "Also")).toBe(false);
    expect(thread(id).streaming).toBe(true);
    expect(last(id).status).toBe("streaming");
    expect(thread(id).queued).toBeUndefined();
  });
});

describe("a pause", () => {
  async function paused(): Promise<string> {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    chat.emit(ev({ chat: id, kind: "text", text: "Part one. ", seq: 1 }));
    chat.emit(ev({ chat: id, kind: "paused", reason: "rounds", detail: "Paused after 80 steps — Continue to let it go on", seq: 2 }));
    return id;
  }

  it("is a calm stop that can be continued in place", async () => {
    const id = await paused();
    expect(thread(id)).toMatchObject({ streaming: false, pause: { reason: "rounds" } });
    expect(last(id)).toMatchObject({ status: "paused", error: null });
    expect(await store().continueThread(id)).toBe(true);
    expect(chat.continues).toEqual([id]);
    expect(thread(id)).toMatchObject({ streaming: true, pause: undefined });
    expect(thread(id).messages).toHaveLength(2);
    chat.emit(ev({ chat: id, turn: "turn-2", kind: "text", text: "Part two.", seq: 3 }));
    chat.emit(ev({ chat: id, turn: "turn-2", kind: "done", seq: 4 }));
    expect(last(id).parts).toEqual([{ kind: "text", text: "Part one. Part two." }]);
    expect(last(id).status).toBe("done");
  });

  it("is put back, with the reason, when it cannot be continued", async () => {
    const id = await paused();
    chat.failNext("The chat is busy");
    expect(await store().continueThread(id)).toBe(false);
    expect(thread(id)).toMatchObject({ streaming: false, pause: { reason: "rounds" } });
    expect(last(id).status).toBe("paused");
  });

  it("cannot be continued when it is not paused or still works", async () => {
    const id = store().start();
    await store().send(id, "Hi");
    expect(await store().continueThread(id)).toBe(false);
    expect(chat.continues).toEqual([]);
  });
});

describe("attachments on a message", () => {
  it("go in the request as references and stay on the question", async () => {
    const id = store().start();
    await store().send(id, "Summarise this", [note, { id: "att-2", name: "shot.png", kind: "image", label: "shot.png · 40 KB" }]);
    expect(chat.requests[0]!.attachments).toEqual([
      { id: "att-1", name: "notes.md", kind: "text" },
      { id: "att-2", name: "shot.png", kind: "image" },
    ]);
    expect(thread(id).messages[0]).toMatchObject({ role: "user", attachments: [{ name: "notes.md" }, { name: "shot.png" }] });
  });

  it("are not in the request when there are none", async () => {
    const id = store().start();
    await store().send(id, "Hello");
    expect("attachments" in chat.requests[0]!).toBe(false);
  });

  it("go again when the question is asked again", async () => {
    const id = store().start();
    await store().send(id, "Summarise this", [note]);
    chat.emit(ev({ chat: id, kind: "done" }));
    await store().regenerate(id);
    expect(chat.requests.at(-1)!.attachments).toEqual([{ id: "att-1", name: "notes.md", kind: "text" }]);
    expect(thread(id).messages[0]).toMatchObject({ attachments: [{ id: "att-1" }] });
  });

  it("let pictures go to a model that may not read them only when the person said so", async () => {
    const id = store().start();
    const picture: SentAttachment = { id: "att-2", name: "shot.png", kind: "image", label: "shot.png" };
    await store().send(id, "What is this?", [picture]);
    expect(chat.requests[0]!.settings).toBeUndefined();
    chat.emit(ev({ chat: id, kind: "done" }));
    store().setAllowImages(id, true);
    await store().send(id, "And this?", [picture]);
    expect(chat.requests[1]!.settings).toEqual({ allowImages: true });
    // Not asked of text alone.
    chat.emit(ev({ chat: id, turn: "turn-2", kind: "done" }));
    await store().send(id, "Just words");
    expect(chat.requests[2]!.settings).toBeUndefined();
  });
});

describe("what finished out of sight", () => {
  it("notes a thread that is done, paused or failed while nothing shows it", async () => {
    const a = store().start();
    const b = store().start();
    const c = store().start();
    await store().send(a, "One");
    await store().send(b, "Two");
    await store().send(c, "Three");
    chat.emit(ev({ chat: a, kind: "done" }));
    chat.emit(ev({ chat: b, turn: "turn-2", kind: "paused", reason: "calls", detail: "Paused after 250 tool calls" }));
    chat.emit(ev({ chat: c, turn: "turn-3", kind: "error", error: "The Claude API did not answer" }));
    expect(useUnread.getState().unseen).toEqual({ [a]: "done", [b]: "needs", [c]: "failed" });
  });

  it("does not note a thread that is in view, or one the person stopped", async () => {
    const a = store().start();
    const b = store().start();
    await store().send(a, "One");
    await store().send(b, "Two");
    useUnread.getState().view(a);
    chat.emit(ev({ chat: a, kind: "done" }));
    chat.emit(ev({ chat: b, turn: "turn-2", kind: "done", stopped: true }));
    expect(useUnread.getState().unseen).toEqual({});
  });

  it("does not note an event for a turn that was over already", async () => {
    const a = store().start();
    await store().send(a, "One");
    chat.emit(ev({ chat: a, kind: "done" }));
    useUnread.setState({ unseen: {} });
    chat.emit(ev({ chat: a, kind: "done" }));
    expect(useUnread.getState().unseen).toEqual({});
  });
});

const summary = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({ id: "old", title: "Plan the trip", updated: 1_700_000_000_000, status: "idle", provider: "Claude", model: "model-small", ...over });
const blob = (id: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  id,
  created: 1,
  provider: "Claude",
  model: "model-small",
  context: [],
  messages: [
    { id: "m1", role: "user", text: "Plan the trip", context: [] },
    { id: "m2", role: "assistant", turn: "t1", provider: "Claude", model: "model-small", parts: [{ kind: "text", text: "Here is a plan." }], status: "done", error: null, pinned: null },
  ],
  session: "s1",
  changed: false,
  undone: false,
  seq: 4,
  ...extra,
});
const loaded = (id: string, over: Partial<LoadedThread> = {}, ui: unknown = blob(id)): LoadedThread => ({ ui, status: "idle", seq: 4, plan: [], title: "Plan the trip", provider: "Claude", model: "model-small", queued: [], ...over });

describe("saved threads", () => {
  it("are listed, and a thread is brought in when it is opened", async () => {
    chat.threadList = [summary()];
    chat.loads["old"] = loaded("old");
    await store().loadSaved();
    expect(store().saved["old"]).toMatchObject({ title: "Plan the trip" });
    expect(store().threads["old"]).toBeUndefined();
    store().open("old");
    await settle();
    expect(thread("old").messages).toHaveLength(2);
    expect(store().active).toBe("old");
    expect(last("old")).toMatchObject({ status: "done" });
  });

  it("take up a thread that is still working, at once, from where the copy stopped", async () => {
    chat.threadList = [summary({ id: "busy", status: "running" })];
    chat.loads["busy"] = loaded("busy", { status: "running", seq: 4 }, blob("busy", { messages: [{ id: "m1", role: "user", text: "Long task", context: [] }, { id: "m2", role: "assistant", turn: "t1", provider: "Claude", model: "m", parts: [{ kind: "text", text: "Started. " }], status: "streaming", error: null, pinned: null }] }));
    chat.snapshots["busy"] = { status: "running", seq: 6, gap: false, events: [ev({ chat: "busy", turn: "t1", kind: "text", text: "Started. ", seq: 4 }), ev({ chat: "busy", turn: "t1", kind: "text", text: "Going on.", seq: 5 })] };
    await store().loadSaved();
    await settle();
    await settle();
    expect(chat.stateAsks).toEqual([["busy", 4]]);
    expect(thread("busy")).toMatchObject({ streaming: true, seq: 5 });
    expect(last("busy").parts).toEqual([{ kind: "text", text: "Started. Going on." }]);
    // And the rest of its events reach it as they come.
    chat.emit(ev({ chat: "busy", turn: "t1", kind: "done", seq: 6 }));
    expect(thread("busy").streaming).toBe(false);
    expect(last("busy").status).toBe("done");
  });

  it("settle a thread whose turn ended while the window was away", async () => {
    chat.threadList = [summary({ id: "gone", status: "idle" })];
    chat.loads["gone"] = loaded("gone", { status: "idle", seq: 4 }, blob("gone", { messages: [{ id: "m1", role: "user", text: "Q", context: [] }, { id: "m2", role: "assistant", turn: "t1", provider: "Claude", model: "m", parts: [{ kind: "text", text: "Half" }], status: "streaming", error: null, pinned: null }] }));
    chat.snapshots["gone"] = { status: "idle", seq: 6, gap: false, events: [ev({ chat: "gone", turn: "t1", kind: "text", text: " and the rest.", seq: 5 }), ev({ chat: "gone", turn: "t1", kind: "done", seq: 6 })] };
    expect(await store().adopt("gone")).toBe(true);
    expect(last("gone").parts).toEqual([{ kind: "text", text: "Half and the rest." }]);
    expect(last("gone").status).toBe("done");
    expect(thread("gone").streaming).toBe(false);
  });

  it("show an interrupted thread as paused, ready to continue", async () => {
    chat.loads["cut"] = loaded("cut", { status: "interrupted" }, blob("cut", { messages: [{ id: "m1", role: "user", text: "Q", context: [] }, { id: "m2", role: "assistant", turn: "t1", provider: "Claude", model: "m", parts: [], status: "streaming", error: null, pinned: null }] }));
    expect(await store().adopt("cut")).toBe(true);
    expect(thread("cut")).toMatchObject({ streaming: false, pause: { reason: "interrupted" } });
    expect(last("cut").status).toBe("paused");
    expect(await store().continueThread("cut")).toBe(true);
    expect(chat.continues).toEqual(["cut"]);
  });

  it("are not made twice when asked for twice", async () => {
    chat.loads["old"] = loaded("old");
    const [a, b] = await Promise.all([store().adopt("old"), store().adopt("old")]);
    expect([a, b]).toEqual([true, true]);
    expect(store().order.filter((o) => o === "old")).toHaveLength(1);
  });

  it("say no for a chat the backend does not have", async () => {
    expect(await store().adopt("nothing")).toBe(false);
    expect(store().threads["nothing"]).toBeUndefined();
  });

  it("are loaded for an event that names a chat the window does not know, without losing the events", async () => {
    chat.loads["away"] = loaded("away", { status: "running", seq: 4 }, blob("away", { messages: [{ id: "m1", role: "user", text: "Q", context: [] }, { id: "m2", role: "assistant", turn: "t1", provider: "Claude", model: "m", parts: [{ kind: "text", text: "A" }], status: "streaming", error: null, pinned: null }] }));
    chat.emit(ev({ chat: "away", turn: "t1", kind: "text", text: "B", seq: 5 }));
    chat.emit(ev({ chat: "away", turn: "t1", kind: "text", text: "C", seq: 6 }));
    await settle();
    await settle();
    expect(last("away").parts).toEqual([{ kind: "text", text: "ABC" }]);
    chat.emit(ev({ chat: "away", turn: "t1", kind: "done", seq: 7 }));
    expect(last("away").status).toBe("done");
  });

  it("do not come back for a chat that was removed here", async () => {
    const id = store().start();
    await store().send(id, "Hi");
    await store().discard(id);
    chat.loads[id] = loaded(id);
    chat.emit(ev({ chat: id, kind: "text", text: "late" }));
    await settle();
    expect(store().threads[id]).toBeUndefined();
  });

  it("are asked to go from the list when they were never opened here", async () => {
    chat.threadList = [summary({ id: "listed" })];
    await store().loadSaved();
    expect(await store().removeSaved("listed")).toBe(true);
    expect(chat.deleted).toEqual(["listed"]);
    expect(store().saved["listed"]).toBeUndefined();
  });
});

describe("keeping a thread", () => {
  it("writes it when a message is sent and again when the turn ends, and never a blank thread", async () => {
    const id = store().start();
    await flushSaves();
    expect(chat.uis).toEqual([]);
    await store().send(id, "Tidy the deck");
    await flushSaves();
    // The question as it went, and again once the turn was bound to its answer.
    expect(chat.uis.length).toBeGreaterThanOrEqual(1);
    expect(chat.uis[0]).toMatchObject({ chat: id, ui: { v: 1, id, messages: [{ text: "Tidy the deck" }, { status: "streaming" }] } });
    chat.emit(ev({ chat: id, kind: "text", text: "Done.", seq: 1 }));
    chat.emit(ev({ chat: id, kind: "done", seq: 2 }));
    await flushSaves();
    const written = chat.uis.at(-1)!.ui as { messages: Answer[]; seq: number };
    expect(written.messages[1]).toMatchObject({ status: "done", parts: [{ kind: "text", text: "Done." }] });
    expect(written.seq).toBe(2);
  });

  it("writes at once when the window goes out of sight, without waiting for the thread to settle", async () => {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    // The question is kept as it is sent; the answer's start waits for the thread to settle.
    await flushSaves();
    const written = chat.uis.length;
    expect(written).toBeGreaterThanOrEqual(1);
    chat.emit(ev({ chat: id, kind: "text", text: "Half way", seq: 1 }));
    flushStream();
    await settle();
    expect(chat.uis).toHaveLength(written);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushSaves();
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    }
    expect(chat.uis).toHaveLength(written + 1);
    expect((chat.uis.at(-1)!.ui as { messages: Answer[] }).messages[1]!.parts).toEqual([{ kind: "text", text: "Half way" }]);
  });

  it("writes a new name too", async () => {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    chat.emit(ev({ chat: id, kind: "done" }));
    await flushSaves();
    const before = chat.uis.length;
    store().rename(id, "Deck tidy-up");
    await flushSaves();
    expect(chat.uis.length).toBe(before + 1);
    expect(chat.uis.at(-1)!.ui).toMatchObject({ title: "Deck tidy-up" });
  });

  it("is what a reloaded window brings back", async () => {
    const id = store().start();
    await store().send(id, "Tidy the deck");
    chat.emit(ev({ chat: id, kind: "text", text: "Done.", seq: 1 }));
    chat.emit(ev({ chat: id, kind: "done", seq: 2 }));
    await flushSaves();
    const ui = chat.uis.at(-1)!.ui;
    // A new window: nothing in memory but what the backend lists.
    resetChat(chat);
    await store().loadProviders();
    chat.threadList = [summary({ id })];
    chat.loads[id] = loaded(id, { seq: 2 }, ui);
    await store().loadSaved();
    expect(await store().adopt(id)).toBe(true);
    expect(thread(id).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(last(id)).toMatchObject({ status: "done", parts: [{ kind: "text", text: "Done." }] });
    expect(thread(id).seq).toBe(2);
  });
});
