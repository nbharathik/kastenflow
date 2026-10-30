// The chat's smaller comforts: asking the last question again or another way,
// naming a chat, finding one, the model in the header, and the "/" list of AI
// actions.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { BUILT_IN_ACTIONS } from "../preview/actions";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { newThread, type Answer, type Thread } from "../thread";
import { Conversation } from "./Conversation";
import { ThreadList } from "./ThreadList";

let chat: Scripted;
const store = () => useChat.getState();

async function show() {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await store().loadProviders();
  const id = store().start({ open: true });
  render(<Conversation id={id} variant="dock" page={null} onClose={() => {}} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

/** A question asked and answered, as the backend would end it. */
async function ask(id: string, box: HTMLElement, text: string, turn: number, reply: string) {
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
  act(() => {
    chat.emit({ chat: id, turn: `turn-${turn}`, kind: "text", text: reply });
    chat.emit({ chat: id, turn: `turn-${turn}`, kind: "done" });
  });
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
});
afterEach(cleanup);

describe("asking again", () => {
  it("offers Regenerate on the newest answer only, and replaces that answer", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First answer.");
    await ask(id, box, "Two", 2, "Second answer.");
    const answers = screen.getAllByRole("article", { name: "Answer" });
    expect(within(answers[0]!).queryByRole("button", { name: "Regenerate" })).toBeNull();
    await act(async () => fireEvent.click(within(answers[1]!).getByRole("button", { name: "Regenerate" })));
    expect(chat.rewinds).toEqual([[id, 1]]);
    expect(chat.requests.map((r) => r.text)).toEqual(["One", "Two", "Two"]);
    // The old answer is gone; the new one is waiting for its text.
    expect(screen.queryByText("Second answer.")).toBeNull();
    expect(screen.getByText("First answer.")).toBeTruthy();
    // Nothing to regenerate while it answers.
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
  });

  it("lets the newest question be edited and sent again, or left alone", async () => {
    const { id, box } = await show();
    await ask(id, box, "Wat is a vector clock?", 1, "A clock.");
    expect(screen.queryByRole("button", { name: "Edit and resend" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit and resend" }));
    const field = screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
    expect(field.value).toBe("Wat is a vector clock?");
    // Escape leaves everything as it was.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
    expect(chat.rewinds).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Edit and resend" }));
    const again = screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
    fireEvent.change(again, { target: { value: "What is a vector clock?" } });
    await act(async () => fireEvent.keyDown(again, { key: "Enter" }));
    expect(chat.rewinds).toEqual([[id, 0]]);
    expect(chat.requests.at(-1)!.text).toBe("What is a vector clock?");
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
    const log = screen.getByRole("log");
    expect(within(log).queryByText("Wat is a vector clock?")).toBeNull();
    expect(within(log).getByText("What is a vector clock?")).toBeTruthy();
    // An empty question is not sent.
    expect(screen.queryByRole("button", { name: "Edit and resend" })).toBeNull();
  });

  it("offers to edit any question that has its answer, but not while an answer is streaming", async () => {
    const { id, box } = await show();
    await ask(id, box, "One", 1, "First.");
    await ask(id, box, "Two", 2, "Second.");
    expect(screen.getAllByRole("button", { name: "Edit and resend" })).toHaveLength(2);
    fireEvent.change(box, { target: { value: "Three" } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(screen.queryByRole("button", { name: "Edit and resend" })).toBeNull();
    act(() => chat.emit({ chat: id, turn: "turn-3", kind: "done" }));
    expect(screen.getAllByRole("button", { name: "Edit and resend" })).toHaveLength(3);
  });
});

describe("a chat's name and header", () => {
  it("is changed in the header, kept with Enter, left with Escape, and goes back when emptied", async () => {
    const { id, box } = await show();
    await ask(id, box, "What is a vector clock?", 1, "A clock.");
    const header = screen.getByRole("banner");
    expect(within(header).getByText("What is a vector clock?")).toBeTruthy();

    fireEvent.click(within(header).getByRole("button", { name: "Rename chat" }));
    let field = within(header).getByRole("textbox", { name: "Chat name" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Clocks" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(store().threads[id]!.title).toBeUndefined();
    expect(within(header).getByText("What is a vector clock?")).toBeTruthy();

    fireEvent.click(within(header).getByRole("button", { name: "Rename chat" }));
    field = within(header).getByRole("textbox", { name: "Chat name" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "  Clocks  " } });
    fireEvent.submit(field.closest("form")!);
    expect(store().threads[id]!.title).toBe("Clocks");
    expect(within(header).getByText("Clocks")).toBeTruthy();

    fireEvent.click(within(header).getByRole("button", { name: "Rename chat" }));
    field = within(header).getByRole("textbox", { name: "Chat name" }) as HTMLInputElement;
    expect(field.value).toBe("Clocks");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.submit(field.closest("form")!);
    expect(within(header).getByText("What is a vector clock?")).toBeTruthy();
  });

  it("says which model the chat answers with, and what is set for it", async () => {
    const { id } = await show();
    const header = screen.getByRole("banner");
    expect(within(header).getByText("Claude · model-small")).toBeTruthy();
    act(() => store().setSettings(id, { reasoningEffort: "high" }));
    expect(within(header).getByText("Claude · model-small · High effort")).toBeTruthy();
  });
});

describe("finding a chat", () => {
  const thread = (title: string, ...said: string[]): Thread => ({
    ...newThread(),
    title,
    messages: said.flatMap((text, i) => [
      { id: `q${title}${i}`, role: "user" as const, text, context: [] },
      { id: `a${title}${i}`, role: "assistant" as const, turn: "t", provider: "p", model: "m", parts: [{ kind: "text" as const, text: `Reply to ${text}` }], status: "done", error: null, pinned: null } satisfies Answer,
    ]),
  });

  it("filters the list by name or anything said, and says how many were found", () => {
    const [a, b, c] = [thread("Clocks", "What is a vector clock?"), thread("Trip", "Where do we stay in Lisbon?"), thread("Budget", "How much is the train?")];
    useChat.setState({ threads: { [a.id]: a, [b.id]: b, [c.id]: c }, order: [a.id, b.id, c.id], active: a.id });
    render(<ThreadList active={a.id} />);
    const search = screen.getByRole("searchbox", { name: "Search chats" });
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);

    fireEvent.change(search, { target: { value: "lisbon" } });
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Trip")]);
    expect(screen.getByText("1 found")).toBeTruthy();
    fireEvent.change(search, { target: { value: "CLOCK" } });
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Clocks")]);
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("0 found")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the / list of AI actions", () => {
  it("opens on a / in an empty box, and puts what the action does in the box", async () => {
    const { box } = await show();
    fireEvent.change(box, { target: { value: "/" } });
    const list = await screen.findByRole("dialog", { name: "Run an AI action" });
    await within(list).findByRole("option", { name: "Outline" });
    // Every shipped action that is offered in the chat is in the list (the LaTeX editor's own is not).
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(BUILT_IN_ACTIONS.filter((a) => a.where.includes("chat")).map((a) => a.title));
    await act(async () => fireEvent.click(within(list).getByRole("option", { name: "Outline" })));
    expect(screen.queryByRole("dialog", { name: "Run an AI action" })).toBeNull();
    expect(box.value).toBe(BUILT_IN_ACTIONS.find((a) => a.slug === "outline")!.instruction);
  });

  it("leaves the / alone when closed with Escape, and does not open in the middle of a message", async () => {
    const { box } = await show();
    fireEvent.change(box, { target: { value: "/" } });
    const list = await screen.findByRole("dialog", { name: "Run an AI action" });
    fireEvent.keyDown(within(list).getByRole("textbox", { name: "Run an AI action" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Run an AI action" })).toBeNull();
    expect(box.value).toBe("/");

    fireEvent.change(box, { target: { value: "half a thought /" } });
    expect(screen.queryByRole("dialog", { name: "Run an AI action" })).toBeNull();
  });
});
