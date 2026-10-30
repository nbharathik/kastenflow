// Asking again keeps what was there as a version ("‹ 2 / 3 ›"); any earlier
// question can be changed and branches; copying; the toast when a rewind
// fails; the empty answer; the keys of the chat.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../../workspace/overlays/commands";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { DEFAULT_KEYS, lookupFor, resolveKeymap } from "../../shortcuts/keymap";
import { copyLastAnswer } from "../copy";
import { focusComposer } from "../keys";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { Conversation } from "./Conversation";

let chat: Scripted;
const store = () => useChat.getState();
const toasts = () => useWorkspace.getState().toasts.map((t) => t.text);

async function show() {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await store().loadProviders();
  const id = store().start({ open: true });
  render(<Conversation id={id} variant="dock" page={null} onClose={() => {}} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

async function send(box: HTMLElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
}

const reply = (id: string, turn: number, text: string) =>
  act(() => {
    chat.emit({ chat: id, turn: `turn-${turn}`, kind: "text", text });
    chat.emit({ chat: id, turn: `turn-${turn}`, kind: "done" });
  });

async function ask(id: string, box: HTMLElement, text: string, turn: number, said: string) {
  await send(box, text);
  reply(id, turn, said);
}

const clipboard = { writeText: vi.fn(async (_text: string) => {}) };

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useWorkspace.setState({ toasts: [] });
  clipboard.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(cleanup);

describe("versions of an answer", () => {
  it("keeps the replaced answer after Regenerate, and the switcher moves between them", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First answer.");
    expect(screen.queryByRole("group", { name: "Versions of this answer" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Regenerate" })));
    reply(id, 2, "Second answer.");
    const group = () => screen.getByRole("group", { name: "Versions of this answer" });
    expect(group().textContent).toContain("2 / 2");
    expect(within(group()).getByRole("button", { name: "Next version" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(group()).getByRole("button", { name: "Previous version" }));
    expect(screen.getByText("First answer.")).toBeTruthy();
    expect(screen.queryByText("Second answer.")).toBeNull();
    expect(group().textContent).toContain("1 / 2");
    // The pressed end is reached: the focus moves to the other button of the new switcher.
    expect(document.activeElement).toBe(within(group()).getByRole("button", { name: "Next version" }));
    // An earlier version is for reading: it cannot be asked again.
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit and resend" })).toBeNull();

    fireEvent.click(within(group()).getByRole("button", { name: "Next version" }));
    expect(screen.getByText("Second answer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });

  it("sends into the version the assistant remembers, not the one on screen", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First answer.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Regenerate" })));
    reply(id, 2, "Second answer.");
    fireEvent.click(within(screen.getByRole("group", { name: "Versions of this answer" })).getByRole("button", { name: "Previous version" }));
    await send(box, "Next question");
    reply(id, 3, "Third answer.");
    const log = screen.getByRole("log");
    expect(within(log).getByText("Second answer.")).toBeTruthy();
    expect(within(log).getByText("Third answer.")).toBeTruthy();
    expect(within(log).queryByText("First answer.")).toBeNull();
  });

  it("branches when an earlier question is changed, and the old branch stays reachable", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First.");
    await ask(id, box, "Two", 2, "Second.");
    // The first question of two is changed.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit and resend" })[0]!);
    const field = screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "One, changed" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(chat.rewinds).toEqual([[id, 0]]);
    expect(chat.requests.at(-1)!.text).toBe("One, changed");
    reply(id, 3, "Changed answer.");
    const log = screen.getByRole("log");
    expect(within(log).queryByText("Second.")).toBeNull();
    expect(within(log).getByText("Changed answer.")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("group", { name: "Versions of this answer" })).getByRole("button", { name: "Previous version" }));
    expect(within(log).getByText("One")).toBeTruthy();
    expect(within(log).getByText("Second.")).toBeTruthy();
    expect(within(log).queryByText("Changed answer.")).toBeNull();
  });

  it("is kept with the thread when it is saved", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First answer.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Regenerate" })));
    reply(id, 2, "Second answer.");
    await act(async () => void (await import("../store")).flushSaves());
    const saved = chat.uis.at(-1)!.ui as { forks?: { at: number; versions: unknown[] }[]; messages: { id: string }[] };
    expect(saved.forks).toHaveLength(1);
    expect(saved.forks![0]!.versions).toHaveLength(2);
    expect(saved.messages).toHaveLength(2);
  });
});

describe("copying", () => {
  it("copies an answer as words, or with its Markdown marks, and a question as typed", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "**Bold** and [[Hotel ideas]] with [a link](https://example.com).");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("Bold and Hotel ideas with a link.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" })));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("**Bold** and [[Hotel ideas]] with [a link](https://example.com).");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy question" })));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("One");
  });

  it("copies the last answer from the key's command, and says when there is none", async () => {
    const { id, box } = await show();
    await copyLastAnswer(store().threads[id]);
    expect(toasts()).toContain("No answer to copy yet");
    await ask(id, box, "One", 1, "First answer.");
    await act(async () => void (await copyLastAnswer(store().threads[id])));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("First answer.");
    expect(toasts()).toContain("Copied the last answer");
  });
});

describe("when asking again fails", () => {
  it("says so with a toast and leaves the conversation as it was", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First answer.");
    chat.rewind = async () => {
      throw new Error("backend gone");
    };
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Regenerate" })));
    expect(toasts()).toContain("Could not take the answer back, so nothing was changed");
    expect(screen.getByText("First answer.")).toBeTruthy();
    expect(store().threads[id]!.forks).toBeUndefined();
    expect(chat.requests).toHaveLength(1);
  });
});

describe("an answer with nothing in it", () => {
  it("says no reply came back, and Retry asks the question again in its place", async () => {
    const { id, box } = await show();
    await send(box, "One");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    expect(screen.getByText("No reply came back")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(chat.rewinds).toEqual([[id, 0]]);
    expect(chat.requests.map((r) => r.text)).toEqual(["One", "One"]);
    expect(within(screen.getByRole("log")).getAllByText("One")).toHaveLength(1);
  });
});

describe("the chat's keys", () => {
  it("Esc stops a running answer when the box is empty or not in use, and otherwise leaves it", async () => {
    const { id, box } = await show();
    await send(box, "One");
    // Something typed: Esc is the box's.
    fireEvent.change(box, { target: { value: "half a thought" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(chat.stops).toEqual([]);
    // Outside the chat it is not ours.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(chat.stops).toEqual([]);
    fireEvent.change(box, { target: { value: "" } });
    await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
    expect(chat.stops).toEqual([id]);
  });

  it("Esc stops from elsewhere in the chat, and does nothing when no answer is running", async () => {
    const { id, box } = await show();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(chat.stops).toEqual([]);
    await send(box, "One");
    await act(async () => fireEvent.keyDown(screen.getByRole("log"), { key: "Escape" }));
    expect(chat.stops).toEqual([id]);
  });

  it("the up arrow in an empty box opens the last question to be changed", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First.");
    fireEvent.change(box, { target: { value: "typing" } });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("One");
  });

  it("has keys for copying the last answer and for the message box, without taking another command's key", async () => {
    expect(DEFAULT_KEYS["chat-copy-answer"]).toEqual(["Mod+Shift+C"]);
    expect(DEFAULT_KEYS["chat-focus"]).toEqual(["Mod+L"]);
    const lookup = lookupFor(resolveKeymap({}, false));
    expect(lookup.get("Mod+Shift+C")).toBe("chat-copy-answer");
    expect(lookup.get("Mod+L")).toBe("chat-focus");
    const all = Object.values(DEFAULT_KEYS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(COMMANDS.some((c) => c.id === "chat-copy-answer") && COMMANDS.some((c) => c.id === "chat-focus")).toBe(true);
    const { box } = await show();
    box.blur();
    focusComposer();
    expect(document.activeElement).toBe(box);
  });
});
