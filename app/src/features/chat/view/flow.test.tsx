// How a thread moves and holds up: scrolling and the jump pill, the polite
// announcement, time while working, folded runs of steps, messages entering,
// writing while offline, and a rate limit.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { Answer, Part } from "../thread";
import { Conversation } from "./Conversation";
import { RATE_WAIT_SECONDS } from "./AnswerLines";
import { clock } from "./use-elapsed";

const flowCss = readFileSync("src/features/chat/flow.css", "utf8");

let chat: Scripted;
const store = () => useChat.getState();

async function show() {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await store().loadProviders();
  const id = store().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

async function send(box: HTMLElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
}

const scroller = () => document.querySelector<HTMLElement>(".kasten-chat-scroll")!;

/** jsdom has no layout: the scroll box is 100 tall in a list 1000 tall. */
function layout() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: function (this: HTMLElement) { return this.classList.contains("kasten-chat-scroll") ? 100 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: function (this: HTMLElement) { return this.classList.contains("kasten-chat-scroll") ? 1000 : 0; } });
  // A browser's smooth scroll arrives, and says so, as the events a scroll sends.
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === "object" ? (options.top ?? 0) : 0;
    this.dispatchEvent(new Event("scroll"));
    this.dispatchEvent(new Event("scrollend"));
  } as never;
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useWorkspace.setState({ toasts: [] });
  document.documentElement.dataset.motion = "on";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)["clientHeight"];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)["scrollHeight"];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)["scrollTo"];
  delete document.documentElement.dataset.motion;
});

describe("scrolling", () => {
  it("offers a way back to the latest while an answer streams and you are reading above, and does not drag you down", async () => {
    layout();
    const { id, box } = await show();
    await send(box, "One");
    expect(scroller().scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    const pill = screen.getByRole("button", { name: /Jump to latest/ });
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "text", text: "More and more words." }));
    expect(scroller().scrollTop).toBe(100);
    document.documentElement.dataset.motion = "off";
    fireEvent.click(pill);
    expect(scroller().scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
  });

  it("marks what came below after the answer ended, until you are there", async () => {
    layout();
    const { id, box } = await show();
    await send(box, "One");
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "text", text: "Words." }));
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    const pill = screen.getByRole("button", { name: /New below/ });
    expect(pill.querySelector(".kasten-chat-jump-dot")).toBeTruthy();
    scroller().scrollTop = 990;
    fireEvent.scroll(scroller());
    expect(screen.queryByRole("button", { name: /New below/ })).toBeNull();
  });

  it("brings the bottom into view when you send, smoothly, or at once with motion off", async () => {
    layout();
    const { id, box } = await show();
    await send(box, "One");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    const scrollTo = vi.fn();
    scroller().scrollTo = scrollTo as never;
    await send(box, "Two");
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });

    act(() => chat.emit({ chat: id, turn: "turn-2", kind: "done" }));
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    scrollTo.mockClear();
    document.documentElement.dataset.motion = "off";
    await send(box, "Three");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller().scrollTop).toBe(1000);
  });
});

describe("saying what happened", () => {
  it("holds the log back while it streams and says 'Answer finished' once, in a region of its own", async () => {
    const { id, box } = await show();
    const log = () => screen.getByRole("log");
    const said = () => document.querySelector("[data-announcer]")!.textContent;
    await send(box, "One");
    expect(log().getAttribute("aria-busy")).toBe("true");
    expect(said()).toBe("");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "text", text: "Words." }));
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    expect(log().getAttribute("aria-busy")).toBe("false");
    expect(said()).toBe("Answer finished");
    // The next turn clears it, so the same words are announced again.
    await send(box, "Two");
    expect(said()).toBe("");
    act(() => chat.emit({ chat: id, turn: "turn-2", kind: "done" }));
    expect(said()).toBe("Answer finished");
  });
});

describe("time and steps", () => {
  it("shows how long it has worked, then the number of steps", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { id, box } = await show();
    await send(box, "One");
    expect(screen.getByText("Working · 0:00")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(42_000));
    expect(screen.getByText("Working · 0:42")).toBeTruthy();
    act(() => {
      chat.emit({ chat: id, turn: "turn-1", kind: "tool", tool: { id: "c1", name: "create_note", input: null } });
      chat.emit({ chat: id, turn: "turn-1", kind: "toolResult", result: { id: "c1", ok: true, summary: "Made a card", paths: [] } });
      chat.emit({ chat: id, turn: "turn-1", kind: "tool", tool: { id: "c2", name: "create_note", input: null } });
      chat.emit({ chat: id, turn: "turn-1", kind: "toolResult", result: { id: "c2", ok: true, summary: "Made another", paths: [] } });
      chat.emit({ chat: id, turn: "turn-1", kind: "done" });
    });
    expect(screen.queryByText(/Working ·/)).toBeNull();
    expect(screen.getByText("model-small · 2 steps")).toBeTruthy();
  });

  it("writes a clock", () => {
    expect([0, 42, 62, 3725].map(clock)).toEqual(["0:00", "0:42", "1:02", "1:02:05"]);
  });
});

describe("a long run of steps", () => {
  const call = (id: string, ok: boolean, summary: string): Part => ({ kind: "tool", call: { id, name: "create_note", input: null }, result: { id, ok, summary, paths: [] } });

  function put(parts: Part[]) {
    const id = store().start({ open: true });
    const answer: Answer = { id: "a1", role: "assistant", turn: "t", provider: "Claude", model: "model-small", parts, status: "done", error: null, pinned: null };
    useChat.setState((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id]!, messages: [{ id: "q1", role: "user", text: "Go", context: [] }, answer] } } }));
    render(<Conversation id={id} variant="full" page={null} />);
  }

  it("leaves four steps as they are", () => {
    put(Array.from({ length: 4 }, (_, i) => call(`c${i}`, true, `Step ${i}`)));
    expect(screen.queryByRole("button", { name: /steps/ })).toBeNull();
    expect(screen.getAllByText(/^Step \d$/)).toHaveLength(4);
  });

  it("folds more into one line that opens, keeping a failed step and one waiting for review in sight", () => {
    const parts = Array.from({ length: 10 }, (_, i) => call(`c${i}`, true, `Done ${i}`));
    parts[3] = call("c3", false, "Could not change that");
    parts[6] = call("c6", true, "Proposal 7 is waiting for review");
    put(parts);
    const fold = screen.getByRole("button", { name: "10 steps · 1 waiting · 1 failed" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Done 0")).toBeNull();
    expect(screen.getByText("Could not change that")).toBeTruthy();
    expect(screen.getByText(/Proposal 7 is/)).toBeTruthy();
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText(/^Done \d$/)).toHaveLength(8);
    fireEvent.click(fold);
    expect(screen.queryByText("Done 0")).toBeNull();
  });
});

describe("entering", () => {
  it("moves in only what arrives after the thread opened, through the motion tokens", async () => {
    const { box } = await show();
    await send(box, "One");
    const log = screen.getByRole("log");
    expect(log.querySelectorAll(".is-entering").length).toBe(2);
    expect(flowCss).toContain("animation: kasten-enter var(--motion-fast) var(--ease-standard)");
    expect(flowCss).toContain(':root[data-motion="off"] .is-entering');
    // No duration is written out: the tokens carry them, and carry none when motion is off.
    expect(flowCss).not.toMatch(/(animation|transition)[^;]*\d+m?s\b/);
  });

  it("does not move the messages of a thread that was already there", () => {
    const id = store().start({ open: true });
    useChat.setState((s) => ({
      threads: { ...s.threads, [id]: { ...s.threads[id]!, messages: [{ id: "q1", role: "user", text: "Old", context: [] }] } },
    }));
    render(<Conversation id={id} variant="full" page={null} />);
    expect(within(screen.getByRole("log")).getByText("Old").closest(".kasten-chat-question")!.classList.contains("is-entering")).toBe(false);
  });
});

describe("offline", () => {
  const online = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);

  it("keeps what you write with a quiet line and sends it when the connection is back", async () => {
    const { id, box } = await show();
    const state = online(false);
    await send(box, "Are you there?");
    expect(chat.requests).toEqual([]);
    expect(screen.getByText("Offline — will send when you're back")).toBeTruthy();
    expect(box.value).toBe("");
    state.mockReturnValue(true);
    await act(async () => void window.dispatchEvent(new Event("online")));
    expect(chat.requests.map((r) => r.text)).toEqual(["Are you there?"]);
    expect(screen.queryByText("Offline — will send when you're back")).toBeNull();
    expect(store().threads[id]!.offline).toBeUndefined();
    expect(within(screen.getByRole("log")).getAllByText("Are you there?")).toHaveLength(1);
  });

  it("does not show a failed answer when the send fails because the connection went", async () => {
    const { id, box } = await show();
    online(true).mockReturnValueOnce(true).mockReturnValue(false);
    chat.failNext("Failed to fetch");
    await send(box, "One");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Offline — will send when you're back")).toBeTruthy();
    expect(store().threads[id]!.messages).toEqual([]);
    expect(store().threads[id]!.offline).toEqual([{ text: "One" }]);
  });
});

describe("a rate limit", () => {
  it("counts down and asks again by itself, once", async () => {
    const { id, box } = await show();
    await send(box, "One");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "error", error: "Slow down", errorKind: "rateLimited" }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // The countdown starts when the line is drawn: draw it again under fake time.
    cleanup();
    render(<Conversation id={id} variant="full" page={null} />);
    expect(screen.getByText(`Rate limited. Trying again in ${RATE_WAIT_SECONDS}s`)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText(`Rate limited. Trying again in ${RATE_WAIT_SECONDS - 5}s`)).toBeTruthy();
    await act(async () => void vi.advanceTimersByTime(RATE_WAIT_SECONDS * 1000));
    expect(chat.requests.map((r) => r.text)).toEqual(["One", "One"]);
    // It fails again: the person decides.
    act(() => chat.emit({ chat: id, turn: "turn-2", kind: "error", error: "Slow down", errorKind: "rateLimited" }));
    expect(screen.queryByText(/Rate limited\. Trying again/)).toBeNull();
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(chat.requests).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
