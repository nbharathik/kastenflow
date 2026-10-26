// The Chat view end to end on the browser preview's stand-in: a message
// streams an answer whose tool call makes a real card; the answer is pinned,
// the chat saved to chats/, and the chat's changes undone.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSessionRequests } from "../review/session-request";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { currentTab } from "../workspace/tabs";
import { ChatView } from "./ChatView";
import { previewChat } from "./preview/fake-chat";
import { useChat } from "./store";
import { resetChat, scriptedChat } from "./test-kit";

const SEED = { "library/seaside-trip.md": "---\ntitle: Seaside trip\n---\nBoats, beaches and ice cream.\n" };

let vault: MemoryVault;

async function open(client = previewChat(() => vault, { pace: 0 })) {
  resetChat(client);
  useWorkspace.setState({ place: { view: "chat" }, back: [], forward: [], toasts: [], recent: [] });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().go({ view: "chat" });
  render(<ChatView />);
  return screen.findByRole("textbox", { name: "Message" });
}

async function ask(text: string) {
  const box = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
}

const log = () => screen.getByRole("log", { name: "Messages" });

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
});
afterEach(cleanup);

describe("Chat view", () => {
  it("streams an answer whose tool call makes a card, then pins, saves and undoes", async () => {
    await open();
    await ask("Make a card about hotel ideas");
    expect(within(log()).getByText("Make a card about hotel ideas")).toBeTruthy();

    // The tool row names the card and opens it.
    const row = await within(log()).findByText("Created card “Hotel ideas”", {}, { timeout: 10_000 });
    expect(row.closest("[data-state]")!.getAttribute("data-state")).toBe("done");
    const openCard = await screen.findByRole("button", { name: "Open Hotel ideas" });
    // The answer is done when it offers its actions.
    await screen.findByRole("button", { name: "Pin as card" }, { timeout: 10_000 });
    expect(screen.getByRole("button", { name: "Undo this chat's changes" })).toBeTruthy();
    expect((await vault.read("inbox/hotel-ideas.md")).text).toContain("Make a card about hotel ideas");
    fireEvent.click(openCard);
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "inbox/hotel-ideas.md" });
    // The answer's [[wiki link]] opens the page too.
    useWorkspace.getState().go({ view: "chat" });
    await act(async () => fireEvent.click(within(log()).getByRole("link", { name: "Hotel ideas" }), { ctrlKey: true }));
    expect(currentTab(useWorkspace.getState().layout).place).toEqual({ view: "page", path: "inbox/hotel-ideas.md" });
    useWorkspace.getState().go({ view: "chat" });

    // Pin the answer as a card.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pin as card" })));
    await screen.findByRole("button", { name: "Pinned · Open card" });
    const pinned = (await vault.list()).find((n) => n.path.startsWith("inbox/this-is-the-browser-preview"));
    expect(pinned?.kind).toBe("card");
    expect((await vault.read(pinned!.path)).text).toContain("[[Hotel ideas]] is in your Inbox now.");

    // Save the chat: a note in chats/, opened in a new tab.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save chat" })));
    const saved = (await vault.list()).find((n) => n.path.startsWith("chats/"))!;
    expect(saved.path).toMatch(/^chats\/\d{4}-\d{2}-\d{2}-make-a-card-about-hotel-ideas\.md$/);
    expect(saved.kind).toBe("chat");
    const text = (await vault.read(saved.path)).text;
    expect(text).toContain("## You\n\nMake a card about hotel ideas\n\n## Preview\n");
    expect(text).toContain("- Created card “Hotel ideas”: [[Hotel ideas]]");
    expect(currentTab(useWorkspace.getState().layout).place).toEqual({ view: "page", path: saved.path });
    useWorkspace.getState().go({ view: "chat" });

    // Undo what the chat changed: a few changes are undone at once, with a way back.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo this chat's changes" })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await screen.findByRole("status")).textContent).toContain("Reverted 2 changes.");
    expect(screen.getByRole("button", { name: "Undo the undo" })).toBeTruthy();
    expect((await vault.list()).map((n) => n.path)).not.toContain("inbox/hotel-ideas.md");
    expect(screen.queryByRole("button", { name: "Open Hotel ideas" })).toBeNull();
    expect(screen.getByText("This chat's changes were undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See in History" }));
    expect(useWorkspace.getState().place).toEqual({ view: "history" });
    // History opens on this chat's session.
    const session = Object.values(useChat.getState().threads).find((t) => t.changed)!.session;
    const asked: string[] = [];
    function History() {
      useSessionRequests((id) => void asked.push(id));
      return null;
    }
    render(<History />);
    expect(asked).toEqual([session]);
  });

  it("stops an answer, and lists the thread with a new chat beside it", async () => {
    await open(previewChat(() => vault, { pace: 5 }));
    await ask("Tell me everything");
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Stop" })));
    expect(await within(log()).findByText("Stopped", {}, { timeout: 10_000 })).toBeTruthy();
    const threads = screen.getByRole("complementary", { name: "Chats" });
    expect(within(threads).getByRole("button", { name: "Tell me everything" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(within(threads).getByRole("button", { name: /New chat/ }));
    expect(await screen.findByRole("heading", { name: "Ask about your notes" })).toBeTruthy();
    fireEvent.click(within(threads).getByRole("button", { name: "Tell me everything" }));
    expect(within(log()).getByText("Tell me everything")).toBeTruthy();
  });

  it("archives a thread from the list: the backend keeps it saved and only unloads it", async () => {
    const chat = scriptedChat();
    await open(chat);
    await ask("A passing thought");
    const id = useChat.getState().active!;
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    const threads = screen.getByRole("complementary", { name: "Chats" });
    fireEvent.click(within(threads).getByRole("button", { name: "More for A passing thought" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Archive chat" })));
    expect(chat.archives).toEqual([id]);
    expect(chat.resets).toEqual([id]);
    // A new, empty chat takes its place.
    expect(await screen.findByRole("heading", { name: "Ask about your notes" })).toBeTruthy();
    expect(within(screen.getByRole("complementary", { name: "Chats" })).queryByRole("button", { name: "A passing thought" })).toBeNull();
    expect(useChat.getState().threads[id]).toBeUndefined();
  });

  it("shows why an answer failed", async () => {
    const chat = scriptedChat();
    await open(chat);
    chat.failNext("The Anthropic API refused the key");
    await ask("Hello");
    expect((await within(log()).findByRole("alert")).textContent).toBe("The Anthropic API refused the key");
    const id = useChat.getState().active!;
    await ask("Again");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "error", error: "The server went away" }));
    expect(within(log()).getAllByRole("alert").map((a) => a.textContent)).toEqual(["The Anthropic API refused the key", "The server went away"]);
  });

  it("explains how to set up a provider when there is none", async () => {
    await open(scriptedChat([]));
    expect(await screen.findByRole("heading", { name: "Chat needs an AI provider" })).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe("Add an AI provider in Settings to chat");
    fireEvent.click(screen.getByRole("button", { name: "Set up in Settings → AI providers" }));
    expect(useWorkspace.getState().place).toEqual({ view: "settings" });
  });

  it("says so when the providers cannot be read", async () => {
    const chat = scriptedChat();
    chat.providers = async () => {
      throw new Error("The keychain is locked");
    };
    await open(chat);
    expect(await screen.findByRole("heading", { name: "The AI providers could not be read" })).toBeTruthy();
    expect(screen.getByText("The keychain is locked")).toBeTruthy();
  });
});
