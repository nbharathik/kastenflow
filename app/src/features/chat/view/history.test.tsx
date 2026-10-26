// The chat's history in the window: the Archived section (listed, searchable,
// reopened, brought back, deleted after one confirmation), a chat that cannot
// be reopened (Retry or Start a new one), a chat waiting for a place, and the
// tie to a page in the header.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadSummary } from "../agent-types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { Conversation } from "./Conversation";
import { ThreadList } from "./ThreadList";

let chat: Scripted;
const store = () => useChat.getState();

const summary = (id: string, title: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, title, updated: 1_700_000_000_000, status: "idle", provider: "Claude", model: "model-small", ...over });

const saved = (title: string, text = "Here you go.") => ({
  ui: { v: 1, messages: [{ id: "m1", role: "user", text: title, context: [] }, { id: "m2", role: "assistant", turn: "t", provider: "Claude", model: "m", parts: [{ kind: "text", text }], status: "done", error: null, pinned: null }] },
  status: "idle" as const,
  seq: 3,
  plan: [],
  title,
  provider: "Claude",
  model: "model-small",
  queued: [] as string[],
});

beforeEach(async () => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await store().loadProviders();
});
afterEach(cleanup);

async function listWith(threads: ThreadSummary[]) {
  chat.threadList = threads;
  for (const t of threads) chat.loads[t.id] = saved(t.title);
  const id = store().start({ open: true });
  await store().loadSaved();
  render(<ThreadList active={id} />);
  return screen.getByRole("complementary", { name: "Chats" });
}

describe("the Archived section", () => {
  it("lists archived chats apart from the others, with their count, and deletes nothing", async () => {
    const list = await listWith([summary("a", "Recent one"), summary("b", "Old trip", { archived: true }), summary("c", "Old budget", { archived: true })]);
    expect(within(list).getByRole("button", { name: "Recent one" })).toBeTruthy();
    const archived = list.querySelector("details.kasten-chat-archived") as HTMLElement;
    expect(archived.querySelector("summary")!.textContent).toContain("Archived (2)");
    expect(within(archived).getAllByRole("button", { name: /^Old / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Old trip", "Old budget"]);
    // The main list does not hold them.
    expect(within(list).getAllByRole("button", { name: "Old trip" })).toHaveLength(1);
    expect(chat.deleted).toEqual([]);
    expect(chat.archivedDeletes).toEqual([]);
  });

  it("shows no section when nothing is archived", async () => {
    const list = await listWith([summary("a", "Recent one")]);
    expect(list.querySelector("details.kasten-chat-archived")).toBeNull();
  });

  it("is searchable, and says when nothing matches", async () => {
    const list = await listWith([summary("b", "Old trip", { archived: true }), summary("c", "Old budget", { archived: true })]);
    const search = within(list).getByRole("searchbox", { name: "Search archived chats" });
    fireEvent.change(search, { target: { value: "budget" } });
    const archived = list.querySelector("details.kasten-chat-archived") as HTMLElement;
    expect(within(archived).getAllByRole("button", { name: /^Old / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Old budget"]);
    fireEvent.change(search, { target: { value: "zebra" } });
    expect(within(archived).getByText("No archived chat has those words.")).toBeTruthy();
  });

  it("reopens one when it is pressed, without bringing it back to the list", async () => {
    const list = await listWith([summary("b", "Old trip", { archived: true })]);
    await act(async () => fireEvent.click(within(list.querySelector("details")!).getByRole("button", { name: "Old trip" })));
    await waitFor(() => expect(store().active).toBe("b"));
    expect(store().threads["b"]!.messages).toHaveLength(2);
    expect(chat.unarchives).toEqual([]);
  });

  it("brings one back to the list from its menu", async () => {
    const list = await listWith([summary("b", "Old trip", { archived: true })]);
    const archived = list.querySelector("details") as HTMLElement;
    await act(async () => fireEvent.click(within(archived).getByRole("button", { name: "More for Old trip" })));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: "Move back to the list" })));
    expect(chat.unarchives).toEqual(["b"]);
    expect(store().saved["b"]!.archived).toBe(false);
    expect(list.querySelector("details.kasten-chat-archived")).toBeNull();
  });
});

describe("Archive chat", () => {
  it("moves a chat kept from an earlier run to Archived from its menu, deleting nothing", async () => {
    const list = await listWith([summary("a", "Recent one")]);
    await act(async () => fireEvent.click(within(list).getByRole("button", { name: "More for Recent one" })));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: "Archive chat" })));
    expect(chat.archives).toEqual(["a"]);
    expect(chat.deleted).toEqual([]);
    expect(store().saved["a"]!.archived).toBe(true);
    expect((list.querySelector("details.kasten-chat-archived summary") as HTMLElement).textContent).toContain("Archived (1)");
  });

  it("archives the open chat from its header, and it can be opened again from Archived", async () => {
    chat.loads["a"] = saved("Plan the trip");
    chat.threadList = [summary("a", "Plan the trip")];
    await store().loadSaved();
    store().open("a");
    await waitFor(() => expect(store().active).toBe("a"));
    render(<Conversation id="a" variant="full" page={null} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Archive chat" })));
    expect(chat.archives).toEqual(["a"]);
    expect(store().threads["a"]).toBeUndefined();
    expect(store().saved["a"]!.archived).toBe(true);
    // The person opens it again: it is not held back as a chat removed here.
    store().open("a");
    await waitFor(() => expect(store().threads["a"]).toBeTruthy());
  });

  it("keeps a chat that cannot be archived where it is, and says so", async () => {
    chat.loads["a"] = saved("Plan the trip");
    chat.threadList = [summary("a", "Plan the trip")];
    await store().loadSaved();
    store().open("a");
    await waitFor(() => expect(store().active).toBe("a"));
    vi.spyOn(chat, "archive").mockRejectedValue(new Error("This chat is still answering; stop it first"));
    expect(await store().discard("a")).toBe(false);
    expect(store().threads["a"]).toBeTruthy();
    expect(store().saved["a"]!.archived).toBeFalsy();
  });
});

describe("Delete archived chats", () => {
  it("asks once, with the count, and can be cancelled", async () => {
    const list = await listWith([summary("b", "Old trip", { archived: true }), summary("c", "Old budget", { archived: true }), summary("a", "Recent")]);
    fireEvent.click(within(list).getByRole("button", { name: "Delete archived chats…" }));
    const ask = screen.getByRole("alertdialog", { name: "Delete archived chats?" });
    expect(ask.textContent).toContain("Delete 2 archived chats for good? They cannot be brought back.");
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(chat.archivedDeletes).toEqual([]);
    // Escape cancels too.
    fireEvent.click(within(list).getByRole("button", { name: "Delete archived chats…" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(chat.archivedDeletes).toEqual([]);
  });

  it("deletes only the archived ones when confirmed", async () => {
    const list = await listWith([summary("b", "Old trip", { archived: true }), summary("c", "Old budget", { archived: true }), summary("a", "Recent")]);
    fireEvent.click(within(list).getByRole("button", { name: "Delete archived chats…" }));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete 2" })));
    expect(chat.archivedDeletes).toEqual([["b", "c"]]);
    expect(Object.keys(store().saved).sort()).toEqual(["a"]);
    expect(list.querySelector("details.kasten-chat-archived")).toBeNull();
    expect(within(list).getByRole("button", { name: "Recent" })).toBeTruthy();
  });

  it("says which chats were kept and why", async () => {
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    chat.skipOnDelete = [{ id: "c", reason: "It has changes waiting for review" }];
    const list = await listWith([summary("b", "Old trip", { archived: true }), summary("c", "Old budget", { archived: true })]);
    fireEvent.click(within(list).getByRole("button", { name: "Delete archived chats…" }));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete 2" })));
    expect(toast).toHaveBeenCalledWith("1 chat was kept: It has changes waiting for review");
    expect(Object.keys(store().saved)).toEqual(["c"]);
  });
});

describe("a chat that cannot be reopened", () => {
  function conversation() {
    const id = store().start({ open: true });
    render(<Conversation id={id} variant="full" page={null} />);
    return id;
  }

  it("says so with Retry and Start a new one, never an empty chat in its place", async () => {
    chat.threadList = [summary("old", "Plan the trip")];
    chat.loadErrors["old"] = { kind: "adoptFailed", reason: "damaged", message: "This chat's file is damaged." };
    await store().loadSaved();
    conversation();
    store().open("old");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t reopen this chat");
    expect(alert.textContent).toContain("This chat's file is damaged.");
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(store().threads["old"]).toBeUndefined();

    // Retry once it can be read.
    delete chat.loadErrors["old"];
    chat.loads["old"] = saved("Plan the trip");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    await waitFor(() => expect(store().active).toBe("old"));
    expect(store().failedOpen).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts a new chat from the notice, and leaves the unreadable one in the list", async () => {
    chat.threadList = [summary("old", "Plan the trip", { bound: { kind: "page", path: "library/plan.md" } })];
    chat.ties["old"] = { kind: "page", path: "library/plan.md" };
    chat.loadErrors["old"] = { kind: "adoptFailed", reason: "missing", message: "This chat's file is missing." };
    await store().loadSaved();
    conversation();
    store().open("old");
    await screen.findByRole("alert");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start a new one" })));
    await screen.findByRole("textbox", { name: "Message" });
    // The new chat took the tie; the failed one is still saved.
    expect(chat.newThreads).toEqual(["old"]);
    expect(chat.ties["old"]).toBeUndefined();
    expect(store().saved["old"]).toBeTruthy();
    expect(chat.deleted).toEqual([]);
  });

  it("keeps a plain failure (no vault open) as the same notice", async () => {
    chat.threadList = [summary("old", "Plan the trip")];
    chat.loadErrors["old"] = "No vault is open";
    await store().loadSaved();
    conversation();
    store().open("old");
    expect((await screen.findByRole("alert")).textContent).toContain("could not be opened");
  });
});

describe("the events after a gap", () => {
  it("shows the saved screen as it is when the backend can no longer replay what came after", async () => {
    const loaded = { ...saved("Plan the trip"), gap: { from: 4, to: 9 } };
    chat.loads["old"] = loaded;
    chat.snapshots["old"] = { status: "idle", seq: 12, gap: false, events: [{ chat: "old", turn: "t", kind: "text", text: " AND MORE", seq: 10 }] };
    chat.threadList = [summary("old", "Plan the trip")];
    await store().loadSaved();
    expect(await store().adopt("old")).toBe(true);
    // Nothing was asked of `chat_state`, and nothing replayed on a screen with a hole in it.
    expect(chat.stateAsks).toEqual([]);
    const answer = store().threads["old"]!.messages[1]!;
    expect(answer.role === "assistant" && answer.parts).toEqual([{ kind: "text", text: "Here you go." }]);
  });

  it("reads the thread again with chat_load when catching up finds events dropped", async () => {
    chat.loads["old"] = { ...saved("Plan the trip", "First saved text."), status: "running" };
    chat.snapshots["old"] = { status: "running", seq: 40, gap: true, events: [{ chat: "old", turn: "t", kind: "text", text: " NEVER SHOWN", seq: 41 }] };
    expect(await store().adopt("old")).toBe(true);
    // A snapshot that says events were dropped is not replayed on top of the saved screen.
    const first = store().threads["old"]!.messages[1]!;
    expect(first.role === "assistant" && first.parts).toEqual([{ kind: "text", text: "First saved text." }]);
    // The backend has the newest word on the next read; sending while the turn ran asks for what was missed.
    chat.loads["old"] = saved("Plan the trip", "The newest saved text.");
    chat.stateAsks.length = 0;
    await store().send("old", "More please");
    await waitFor(() => {
      const again = store().threads["old"]!.messages[1];
      expect(again?.role === "assistant" && again.parts).toEqual([{ kind: "text", text: "The newest saved text." }]);
    });
    expect(chat.stateAsks.length).toBeGreaterThan(0);
  });
});

describe("a chat in line for a place", () => {
  it("says it is waiting, with its place, until it starts", async () => {
    const id = store().start({ open: true });
    render(<Conversation id={id} variant="full" page={null} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Tidy everything" } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "waiting", n: 2, text: "Waiting for another chat to finish" }));
    expect(screen.getAllByRole("status").map((n) => n.textContent)).toContain("Waiting for another chat to finish · 2 in line");
    expect(store().threads[id]!.waiting).toEqual({ n: 2, text: "Waiting for another chat to finish" });
    // Stop is there to leave the line.
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "started" }));
    expect(screen.queryByText(/Waiting for another chat/)).toBeNull();
    expect(store().threads[id]!.waiting).toBeUndefined();
  });

  it("leaves the line when stopped, and the message can be sent again", async () => {
    const id = store().start({ open: true });
    await store().send(id, "Tidy everything");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "waiting", n: 1, text: "Waiting for another chat to finish" }));
    await store().stop(id);
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done", stopped: true }));
    expect(store().threads[id]!.waiting).toBeUndefined();
    expect(store().threads[id]!.streaming).toBe(false);
    expect(await store().send(id, "Tidy everything")).toBe(true);
    expect(chat.stops).toEqual([id]);
  });

  it("is a status of a saved chat too: it is taken up and waits", async () => {
    chat.threadList = [summary("w", "Queued work", { status: "waiting" })];
    chat.loads["w"] = { ...saved("Queued work"), status: "waiting" };
    await store().loadSaved();
    await waitFor(() => expect(store().threads["w"]).toBeTruthy());
    expect(store().threads["w"]!.streaming).toBe(true);
  });

  it("is named in the list", async () => {
    const list = await listWith([summary("w", "Queued work", { status: "waiting" })]);
    expect(within(list).getByRole("button", { name: "Queued work" }).closest("li")!.textContent).toContain("Waiting");
  });
});

describe("the tie in the header", () => {
  function show(path: string) {
    useWorkspace.setState({ ...derive(initialLayout({ view: "page", path })), notes: [{ path, id: "n1", title: "Plan", kind: "page" } as never] });
    const id = store().start({ open: true });
    render(<Conversation id={id} variant="full" page={null} />);
    return id;
  }

  it("offers to tie the chat to the page in front, and ties it", async () => {
    const id = show("library/plan.md");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Tie this chat to a page" })));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: "Bind to this page" })));
    expect(chat.ties[id]).toEqual({ kind: "page", path: "library/plan.md", id: "n1" });
    expect(store().threads[id]!.bound).toEqual({ kind: "page", path: "library/plan.md", id: "n1" });
    expect(await screen.findByRole("button", { name: "Tied to Plan" })).toBeTruthy();
  });

  it("unties it from the same menu", async () => {
    const id = show("library/plan.md");
    await store().bind(id, { kind: "page", path: "library/plan.md", id: "n1" });
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Tied to Plan" })));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: "Unbind from Plan" })));
    expect(chat.unbinds).toEqual([id]);
    expect(store().threads[id]!.bound).toBeNull();
  });

  it("takes the tie from another chat that had it", async () => {
    const first = show("library/plan.md");
    await store().bind(first, { kind: "page", path: "library/plan.md" });
    const second = store().start();
    await store().bind(second, { kind: "page", path: "library/plan.md" });
    expect(store().threads[first]!.bound).toBeNull();
    expect(store().threads[second]!.bound).toMatchObject({ path: "library/plan.md" });
  });

  it("shows nothing when there is nothing to tie it to", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "trash" })) });
    const id = store().start({ open: true });
    render(<Conversation id={id} variant="full" page={null} />);
    expect(screen.queryByRole("button", { name: "Tie this chat to a page" })).toBeNull();
  });

  it("New chat hands the tie on and leaves the old chat in the list", async () => {
    const id = show("library/plan.md");
    await store().send(id, "First question");
    await store().bind(id, { kind: "page", path: "library/plan.md", id: "n1" });
    const next = await store().newThreadFrom(id, { open: true });
    expect(chat.newThreads).toEqual([id]);
    expect(store().threads[id]!.bound).toBeNull();
    expect(store().threads[next]!.bound).toMatchObject({ path: "library/plan.md" });
    expect(store().threads[id]!.messages).toHaveLength(2);
    expect(chat.resets).toEqual([]);
  });
});
