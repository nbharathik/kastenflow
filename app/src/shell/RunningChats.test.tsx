// The running chats, from the window's top right: which chats work or paused, the document each is tied to, and a click that opens both.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChat } from "../features/chat/store";
import { resetChat, scriptedChat } from "../features/chat/test-kit";
import { newThread, type Thread } from "../features/chat/thread";
import { useUnread } from "../features/chat/unread";
import { deckUi, resetDeckUi } from "../features/slides/deck-ui";
import { useDecks } from "../features/slides/store";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout, openTab } from "../features/workspace/tabs";
import { useShell } from "../lib/store";
import { GlobalActions } from "./GlobalActions";
import { runningRows, useRunningChats } from "./running-chats";

const put = (over: Partial<Thread> & { id: string }) => {
  const thread: Thread = { ...newThread({ id: over.id }), ...over };
  useChat.setState((s) => ({ threads: { ...s.threads, [thread.id]: thread } }));
};

const openPath = vi.fn();

beforeEach(() => {
  resetChat(scriptedChat());
  resetDeckUi();
  useChat.setState({ threads: {} });
  useUnread.setState({ unseen: {}, viewing: {}, working: 0 });
  useRunningChats.setState({ open: false });
  useShell.setState({ chatOpen: false });
  useDecks.setState({ list: [{ path: "decks/talk.deck", title: "Q3 Talk", slides: 4, problem: null } as never] });
  useWorkspace.setState({ ...derive(initialLayout({ view: "page", path: "a.md" })), notes: [], openPath } as never);
  openPath.mockReset();
});
afterEach(cleanup);

const button = () => screen.queryByRole("button", { name: "Running chats" });
const popover = () => screen.findByRole("dialog", { name: "Running chats" });

describe("the running chats button", () => {
  it("is not there when nothing runs", () => {
    render(<GlobalActions />);
    expect(button()).toBeNull();
  });

  it("appears while a chat works or stopped for you, named for what it is", () => {
    render(<GlobalActions />);
    act(() => useUnread.getState().setWorking(2));
    expect(button()!.getAttribute("title")).toContain("2 chats are working");
    act(() => {
      useUnread.getState().setWorking(0);
      useUnread.getState().note("p", "needs");
    });
    expect(button()!.getAttribute("title")).toContain("stopped and needs you");
    act(() => useUnread.getState().note("q", "done"));
    act(() => void useUnread.getState().view("p"));
    expect(button()).toBeNull();
  });
});

describe("the list", () => {
  it("lists the chats that work or paused, with the document each is tied to, and leaves the finished ones out", async () => {
    put({ id: "w", streaming: true, bound: { kind: "deck", path: "decks/talk.deck" } });
    put({ id: "p", pause: { reason: "rounds", detail: "Paused" } as never, bound: { kind: "page", path: "notes/plan.md" }, created: 5 });
    put({ id: "d", messages: [{ role: "assistant", status: "done" } as never] });
    render(<GlobalActions />);
    act(() => useUnread.getState().setWorking(1));
    fireEvent.click(button()!);
    const box = await popover();
    const rows = within(box).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["Q3 TalkWorking · New chat", "plan.mdPaused · New chat"]);
  });

  it("says plainly when nothing runs, and offers the chat", async () => {
    render(<GlobalActions />);
    act(() => useRunningChats.getState().show(true));
    const box = await popover();
    expect(within(box).getByText("No chat is working right now.")).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Open Chat" }));
    expect(useShell.getState().chatOpen).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Running chats" })).toBeNull();
  });

  it("closes with Escape", async () => {
    render(<GlobalActions />);
    act(() => useRunningChats.getState().show(true));
    await popover();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Running chats" })).toBeNull();
  });
});

describe("a click on a chat", () => {
  it("opens its deck in a tab with the assistant panel open", async () => {
    put({ id: "w", streaming: true, bound: { kind: "deck", path: "decks/talk.deck" } });
    render(<GlobalActions />);
    act(() => useUnread.getState().setWorking(1));
    fireEvent.click(button()!);
    fireEvent.click(within(await popover()).getByRole("button", { name: /Q3 Talk/ }));
    expect(openPath).toHaveBeenCalledWith("decks/talk.deck", "tab");
    expect(deckUi("decks/talk.deck")?.panel).toBe("ai");
    expect(useRunningChats.getState().open).toBe(false);
  });

  it("brings the deck's tab forward when it is open", async () => {
    useWorkspace.setState(derive(openTab(initialLayout({ view: "slides", path: "decks/talk.deck" }), { view: "page", path: "a.md" })));
    put({ id: "w", streaming: true, bound: { kind: "deck", path: "decks/talk.deck" } });
    render(<GlobalActions />);
    act(() => useUnread.getState().setWorking(1));
    fireEvent.click(button()!);
    fireEvent.click(within(await popover()).getByRole("button", { name: /Q3 Talk/ }));
    expect(openPath).not.toHaveBeenCalled();
    expect(useWorkspace.getState().place.path).toBe("decks/talk.deck");
  });

  it("opens a page and shows its chat in the dock", async () => {
    put({ id: "p", streaming: true, bound: { kind: "page", path: "notes/plan.md" } });
    render(<GlobalActions />);
    act(() => useUnread.getState().setWorking(1));
    fireEvent.click(button()!);
    fireEvent.click(within(await popover()).getByRole("button", { name: /plan\.md/ }));
    expect(openPath).toHaveBeenCalledWith("notes/plan.md", "tab");
    expect(useChat.getState().active).toBe("p");
    expect(useShell.getState().chatOpen).toBe(true);
  });
});

describe("the order of the rows", () => {
  it("puts working chats before paused ones, newest first", () => {
    const threads: Record<string, Thread> = {
      a: { ...newThread({ id: "a" }), pause: { reason: "rounds", detail: "" } as never, created: 9 },
      b: { ...newThread({ id: "b" }), streaming: true, created: 1 },
      c: { ...newThread({ id: "c" }), streaming: true, created: 3 },
    };
    expect(runningRows(threads, (t) => (t.streaming ? "working" : "paused"), (t) => t.id).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});
