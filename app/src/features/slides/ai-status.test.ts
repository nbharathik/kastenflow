// What the deck's assistant is doing, read from the chat for the dot on the editor's Assistant button.

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetChat, scriptedChat } from "../chat/test-kit";
import { useChat } from "../chat/store";
import { newThread, type Thread } from "../chat/thread";
import { useUnread } from "../chat/unread";
import { deckAiSource, deckAiStatus } from "./ai-status";

const DECK = "library/talk.deck";

function put(over: Partial<Thread>): string {
  const thread: Thread = { ...newThread(), bound: { kind: "deck", path: DECK }, ...over };
  useChat.setState((s) => ({ threads: { ...s.threads, [thread.id]: thread } }));
  return thread.id;
}

const answer = (status: "done" | "error" | "streaming" | "stopped" | "paused") => [
  { role: "user", id: "u", text: "go", created: 1, context: [] },
  { role: "assistant", id: "a", status, parts: [], created: 2 },
];

beforeEach(() => {
  resetChat(scriptedChat());
  useUnread.setState({ unseen: {}, viewing: {}, working: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("the deck's assistant status", () => {
  it("is idle with no chat, or one at rest", () => {
    expect(deckAiStatus(DECK)).toBe("idle");
    put({ messages: answer("done") as never });
    expect(deckAiStatus(DECK)).toBe("idle");
  });

  it("is working while its chat works or waits for a place", () => {
    const id = put({ streaming: true });
    expect(deckAiStatus(DECK)).toBe("working");
    useChat.setState((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id]!, streaming: false, waiting: { n: 1, text: "go" } } } }));
    expect(deckAiStatus(DECK)).toBe("working");
  });

  it("is paused when its chat stopped short and can go on", () => {
    put({ pause: { reason: "rounds", detail: "Paused after 80 steps" } as never });
    expect(deckAiStatus(DECK)).toBe("paused");
  });

  it("shows a failure only until it has been looked at", () => {
    const id = put({ messages: answer("error") as never });
    expect(deckAiStatus(DECK)).toBe("idle");
    act(() => useUnread.getState().note(id, "failed"));
    expect(deckAiStatus(DECK)).toBe("failed");
    act(() => void useUnread.getState().view(id));
    expect(deckAiStatus(DECK)).toBe("idle");
  });

  it("belongs to the deck: another deck's chat does not count", () => {
    put({ streaming: true, bound: { kind: "deck", path: "library/other.deck" } });
    expect(deckAiStatus(DECK)).toBe("idle");
    expect(deckAiStatus("library/other.deck")).toBe("working");
  });

  it("tells a listener when the chat changes", () => {
    const source = deckAiSource(DECK);
    const heard = vi.fn();
    const stop = source.subscribe(heard);
    const id = put({});
    expect(heard).toHaveBeenCalled();
    heard.mockClear();
    act(() => useChat.setState((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id]!, streaming: true } } })));
    expect(heard).toHaveBeenCalled();
    expect(source.current()).toBe("working");
    stop();
    heard.mockClear();
    put({});
    expect(heard).not.toHaveBeenCalled();
  });
});
