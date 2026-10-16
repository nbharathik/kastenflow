import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastModel, modelFor } from "./prefs";
import { flushStream, useChat } from "./store";
import { CLAUDE, resetChat, scriptedChat, LOCAL, type Scripted } from "./test-kit";
import type { Answer } from "./thread";

let chat: Scripted;
const store = () => useChat.getState();
const last = (id: string) => store().threads[id]!.messages.at(-1) as Answer;

beforeEach(async () => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE, LOCAL]);
  resetChat(chat);
  await store().loadProviders();
});

describe("chat store", () => {
  it("sends with the thread's context and the last model used", async () => {
    const id = store().start({ context: [{ kind: "board", label: "Brainstorm", ref: ["boards/brainstorm.canvas"] }] });
    expect(await store().send(id, "  Sort these ideas  ")).toBe(true);
    expect(chat.requests).toEqual([
      { chat: id, provider: "Claude", model: "model-small", text: "Sort these ideas", context: [{ kind: "board", label: "Brainstorm", ref: ["boards/brainstorm.canvas"] }] },
    ]);
    const thread = store().threads[id]!;
    expect(thread.session).toBe(`session-${id}`);
    expect(last(id).turn).toBe("turn-1");
    // While it answers a message is sent too: the backend queues it for the next step.
    chat.queueNext();
    expect(await store().send(id, "More")).toBe(true);
    expect(chat.requests.map((r) => r.text)).toEqual(["Sort these ideas", "More"]);
    expect(store().threads[id]!.messages).toHaveLength(2);

    // A new thread starts with the model chosen last.
    const other = store().start();
    store().choose(other, "Local server", " local-model ");
    expect(lastModel()).toEqual({ provider: "Local server", model: "local-model" });
    const fresh = store().start();
    expect(modelFor(store().threads[fresh]!, store().providers)).toEqual({ provider: "Local server", model: "local-model" });
  });

  it("gives streamed text to the store once per frame, in order with tool rows", async () => {
    const id = store().start();
    await store().send(id, "Make a card");
    const renders = vi.fn();
    const stop = useChat.subscribe(renders);
    for (const text of ["One ", "two ", "three"]) chat.emit({ chat: id, turn: "turn-1", kind: "text", text });
    expect(renders).not.toHaveBeenCalled();
    await expect.poll(() => renders.mock.calls.length).toBe(1);
    expect(last(id).parts).toEqual([{ kind: "text", text: "One two three" }]);

    chat.emit({ chat: id, turn: "turn-1", kind: "text", text: ", and a card:" });
    chat.emit({ chat: id, turn: "turn-1", kind: "tool", tool: { id: "k1", name: "create_note", input: {} } });
    // The tool row waited for the text before it.
    expect(last(id).parts.map((p) => p.kind)).toEqual(["text", "tool"]);
    expect(last(id).parts[0]).toEqual({ kind: "text", text: "One two three, and a card:" });
    // A result that names no paths touched none.
    chat.emit({ chat: id, turn: "turn-1", kind: "toolResult", result: { id: "k1", ok: true, summary: "Searched" } as never });
    expect(last(id).parts[1]).toMatchObject({ kind: "tool", result: { ok: true, paths: [] } });
    expect(store().threads[id]!.changed).toBe(false);
    chat.emit({ chat: id, turn: "turn-1", kind: "done" });
    expect(store().threads[id]!.streaming).toBe(false);
    stop();
  });

  it("stops a turn and shows a failed send as an error", async () => {
    const id = store().start();
    await store().send(id, "Write a long essay");
    chat.emit({ chat: id, turn: "turn-1", kind: "text", text: "Once" });
    await store().stop(id);
    expect(chat.stops).toEqual([id]);
    expect(store().threads[id]!.stopping).toBe(true);
    chat.emit({ chat: id, turn: "turn-1", kind: "done", stopped: true });
    expect(last(id)).toMatchObject({ status: "stopped", parts: [{ kind: "text", text: "Once" }] });
    expect(store().threads[id]!.stopping).toBe(false);

    chat.failNext("The Local server did not answer");
    expect(await store().send(id, "Again")).toBe(true);
    expect(last(id)).toMatchObject({ status: "error", error: "The Local server did not answer" });
    expect(store().threads[id]!.streaming).toBe(false);
    // Events for a thread that is gone change nothing.
    await store().discard(id);
    expect(chat.resets).toEqual([id]);
    chat.emit({ chat: id, turn: "turn-2", kind: "text", text: "late" });
    flushStream();
    expect(store().threads[id]).toBeUndefined();
  });

  it("stops a turn stopped before it began, once it begins", async () => {
    const id = store().start();
    // The app is slow to start the turn; Stop is pressed meanwhile.
    let begin: () => void = () => {};
    const send = chat.send.bind(chat);
    vi.spyOn(chat, "send").mockImplementation(async (request) => {
      await new Promise<void>((done) => (begin = done));
      return send(request);
    });
    const sending = store().send(id, "Write a long essay");
    await Promise.resolve();
    await store().stop(id);
    expect(chat.stops).toEqual([id]);
    begin();
    await sending;
    // The first stop reached no turn; the store asks again once it began.
    expect(chat.stops).toEqual([id, id]);
  });

  it("keeps one chip per thing", () => {
    const id = store().start({ context: [{ kind: "note", label: "Plan", ref: ["library/plan.md"] }] });
    store().addChip(id, { kind: "note", label: "Plan again", ref: ["library/plan.md"] });
    store().addChip(id, { kind: "search", label: "“hilltown”", ref: ["hilltown"] });
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Plan", "“hilltown”"]);
    store().removeChip(id, "note:library/plan.md");
    expect(store().threads[id]!.context.map((c) => c.kind)).toEqual(["search"]);
  });

  it("has no model without a provider, and reads a broken preference as none", async () => {
    resetChat(scriptedChat([]));
    await store().loadProviders();
    const id = store().start();
    expect(modelFor(store().threads[id]!, store().providers)).toBeNull();
    expect(await store().send(id, "Hello")).toBe(false);
    localStorage.setItem("kasten.chat.model", "{not json");
    expect(lastModel()).toBeNull();
    localStorage.setItem("kasten.chat.model", JSON.stringify({ provider: 7 }));
    expect(lastModel()).toBeNull();
  });

  it("saves and removes providers through the backend", async () => {
    await store().saveProvider({ name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-large" }, null);
    expect(chat.saved[0]).toEqual({ provider: { name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-large" }, key: null });
    expect(store().providers!.find((p) => p.name === "Claude")).toMatchObject({ model: "model-large", hasKey: true });
    await store().removeProvider("Local server");
    expect(store().providers!.map((p) => p.name)).toEqual(["Claude"]);
  });
});
