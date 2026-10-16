// The thread's page chip that follows the page in front, a thread's name, and
// asking the last question again: the pure rules and the store's use of them.

import { beforeEach, describe, expect, it } from "vitest";

import { useChat } from "./store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "./test-kit";
import { followChips, matchesThread, newThread, rememberedQuestions, threadTitle, type Answer, type Chip, type Message } from "./thread";

const note = (name: string, origin?: Chip["origin"]): Chip => ({ kind: "note", label: name, ref: [`library/${name.toLowerCase()}.md`], ...(origin ? { origin } : {}) });

describe("followChips", () => {
  it("swaps the one followed chip, first, and keeps the rest", () => {
    const context = [note("Plan", "auto"), note("Trip", "added"), note("Kept", "pinned")];
    const next = followChips(context, note("Notes"));
    expect(next.map((c) => [c.label, c.origin])).toEqual([
      ["Notes", "auto"],
      ["Trip", "added"],
      ["Kept", "pinned"],
    ]);
    // Without anything followed yet, it comes in first.
    expect(followChips([note("Trip", "added")], note("Plan")).map((c) => c.label)).toEqual(["Plan", "Trip"]);
  });

  it("changes nothing, not even the array, when the same page is already followed", () => {
    const context = [note("Plan", "auto"), note("Trip", "added")];
    expect(followChips(context, note("Plan"))).toBe(context);
    expect(followChips([], null)).toEqual([]);
  });

  it("does not add a page the person already has pinned or added, and lets the old one go", () => {
    const context = [note("Plan", "auto"), note("Notes", "pinned")];
    const next = followChips(context, note("Notes"));
    expect(next.map((c) => [c.label, c.origin])).toEqual([["Notes", "pinned"]]);
    expect(followChips([note("Notes", "added")], note("Notes")).map((c) => c.origin)).toEqual(["added"]);
  });

  it("takes the followed chip away when no page is followed", () => {
    expect(followChips([note("Plan", "auto"), note("Trip", "added")], null).map((c) => c.label)).toEqual(["Trip"]);
  });
});

const answer = (status: Answer["status"], parts: Answer["parts"] = []): Answer => ({ id: `a${Math.random()}`, role: "assistant", turn: "t", provider: "p", model: "m", parts, status, error: null, pinned: null });
const question = (text: string): Message => ({ id: `q${Math.random()}`, role: "user", text, context: [] });
const said = [{ kind: "text" as const, text: "Hello" }];

describe("rememberedQuestions", () => {
  it("counts the questions whose answer said something or finished", () => {
    const messages = [question("one"), answer("done", said), question("two"), answer("error"), question("three"), answer("stopped"), question("four"), answer("error", said), question("five"), answer("done")];
    expect(rememberedQuestions(messages)).toBe(3);
    // Up to a point only.
    expect(rememberedQuestions(messages, 2)).toBe(1);
    expect(rememberedQuestions(messages, 0)).toBe(0);
    expect(rememberedQuestions([question("waiting")])).toBe(0);
  });
});

describe("a thread's name and search", () => {
  it("is the name the person gave it, else the first question, and an empty name goes back", () => {
    const thread = { ...newThread(), messages: [question("What is a vector clock?"), answer("done", said)] };
    expect(threadTitle(thread)).toBe("What is a vector clock?");
    expect(threadTitle({ ...thread, title: "  Clocks  " })).toBe("Clocks");
    expect(threadTitle({ ...newThread(), title: "  " })).toBe("New chat");
  });

  it("is found by its name or anything said in it, in any case", () => {
    const thread = { ...newThread(), title: "Clocks", messages: [question("What is a vector clock?"), answer("done", [{ kind: "text" as const, text: "A way to order EVENTS." }])] };
    for (const query of ["clocks", "VECTOR", "events", "  order  ", ""]) expect(matchesThread(thread, query), query).toBe(true);
    for (const query of ["quorum", "lamport"]) expect(matchesThread(thread, query), query).toBe(false);
  });
});

let chat: Scripted;
const store = () => useChat.getState();
const messages = (id: string) => store().threads[id]!.messages;

beforeEach(async () => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  await store().loadProviders();
});

/** One question answered, as the backend would end it. */
async function asked(id: string, text: string, turn: number, reply = "An answer.") {
  expect(await store().send(id, text)).toBe(true);
  chat.emit({ chat: id, turn: `turn-${turn}`, kind: "text", text: reply });
  chat.emit({ chat: id, turn: `turn-${turn}`, kind: "done" });
}

describe("following in the store", () => {
  it("follows by default, and swaps the chip, until it is turned off", () => {
    const id = store().start();
    store().followPage(id, note("Plan"));
    expect(store().threads[id]!.context.map((c) => [c.label, c.origin])).toEqual([["Plan", "auto"]]);
    store().followPage(id, note("Notes"));
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Notes"]);
    store().setFollow(id, false);
    store().followPage(id, note("Ideas"));
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Notes"]);
    store().setFollow(id, true);
    store().followPage(id, note("Ideas"));
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Ideas"]);
  });

  it("pins and unpins only a followed chip; added chips have nothing to pin", () => {
    const id = store().start();
    store().followPage(id, note("Plan"));
    store().addChip(id, note("Trip"));
    const key = (name: string) => `note:library/${name.toLowerCase()}.md`;
    store().pinChip(id, key("Plan"), true);
    store().pinChip(id, key("Trip"), true);
    expect(store().threads[id]!.context.map((c) => [c.label, c.origin])).toEqual([
      ["Plan", "pinned"],
      ["Trip", "added"],
    ]);
    store().followPage(id, note("Notes"));
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Notes", "Plan", "Trip"]);
    store().pinChip(id, key("Plan"), false);
    store().followPage(id, note("Ideas"));
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Ideas", "Trip"]);
  });

  it("starts a thread about one page without following when asked", () => {
    const id = store().start({ context: [note("Plan")], follow: false });
    store().followPage(id, note("Notes"));
    expect(store().threads[id]!.context.map((c) => [c.label, c.origin])).toEqual([["Plan", "added"]]);
  });

  it("names a thread, and an empty name takes it back", () => {
    const id = store().start();
    store().rename(id, "  Clocks  ");
    expect(store().threads[id]!.title).toBe("Clocks");
    store().rename(id, "   ");
    expect(store().threads[id]!.title).toBeUndefined();
  });

  it("sends the chips without the window's marker", async () => {
    const id = store().start();
    store().followPage(id, note("Plan"));
    await store().send(id, "Hi");
    expect(chat.requests[0]!.context).toEqual([{ kind: "note", label: "Plan", ref: ["library/plan.md"] }]);
    expect(messages(id)[0]).toMatchObject({ role: "user", context: [{ kind: "note", label: "Plan", ref: ["library/plan.md"] }] });
  });
});

describe("asking the last question again", () => {
  it("takes the thread back to before it, and asks it in place of the answer", async () => {
    const id = store().start();
    await asked(id, "One", 1, "First.");
    await asked(id, "Two", 2, "Second.");
    expect(await store().regenerate(id)).toBe(true);
    expect(chat.rewinds).toEqual([[id, 1]]);
    expect(chat.requests.map((r) => r.text)).toEqual(["One", "Two", "Two"]);
    // The pair was replaced, not added to.
    expect(messages(id).map((m) => (m.role === "user" ? m.text : "answer"))).toEqual(["One", "answer", "Two", "answer"]);
    expect((messages(id).at(-1) as Answer).status).toBe("streaming");
  });

  it("asks another question in place of the last, with the thread taken back first", async () => {
    const id = store().start();
    await asked(id, "One", 1);
    expect(await store().resend(id, "  One, said better  ")).toBe(true);
    expect(chat.rewinds).toEqual([[id, 0]]);
    expect(chat.requests.at(-1)!.text).toBe("One, said better");
    expect(messages(id).map((m) => (m.role === "user" ? m.text : "answer"))).toEqual(["One, said better", "answer"]);
  });

  it("counts only the questions the backend remembers", async () => {
    const id = store().start();
    await asked(id, "One", 1);
    // A question that failed before the model said anything left no trace.
    chat.failNext("The Claude API did not answer");
    await store().send(id, "Two");
    await asked(id, "Three", 2);
    await store().regenerate(id);
    expect(chat.rewinds).toEqual([[id, 1]]);
  });

  it("does nothing while it answers, without a question to ask, or without a provider", async () => {
    const id = store().start();
    expect(await store().regenerate(id)).toBe(false);
    await store().send(id, "One");
    expect(await store().regenerate(id)).toBe(false);
    expect(await store().resend(id, "Other")).toBe(false);
    chat.emit({ chat: id, turn: "turn-1", kind: "done" });
    expect(await store().resend(id, "   ")).toBe(false);
    expect(chat.rewinds).toEqual([]);
    expect(messages(id)).toHaveLength(2);

    // No provider to ask: nothing is taken back that could not be sent.
    useChat.setState({ providers: [] });
    expect(await store().regenerate(id)).toBe(false);
    expect(chat.rewinds).toEqual([]);
    expect(messages(id)).toHaveLength(2);
  });
});
