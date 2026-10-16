// What the agent harness shows in a thread: a pause that is no failure, with
// Continue; a message waiting for the next step; the plan; a connection tried
// again; the step; and the list of threads with what each is doing.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { flushStream, useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChatEvent } from "../types";
import { useUnread } from "../unread";
import { Conversation } from "./Conversation";
import { ThreadList } from "./ThreadList";

let chat: Scripted;

async function show() {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });
async function ask(box: HTMLElement, text: string) {
  type(box, text);
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
}
const emit = (id: string, event: Partial<ChatEvent> & Pick<ChatEvent, "kind">, turn = "turn-1") => act(() => chat.emit({ chat: id, turn, ...event }));
const log = () => screen.getByRole("log", { name: "Messages" });

beforeEach(() => {
  localStorage.clear();
  useUnread.setState({ unseen: {}, viewing: {} });
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
});
afterEach(cleanup);

describe("a pause", () => {
  it("is a calm line that says why, with Continue; it is not an error", async () => {
    const { id, box } = await show();
    await ask(box, "Tidy the whole deck");
    emit(id, { kind: "text", text: "Working through it. " });
    emit(id, { kind: "paused", reason: "rounds", detail: "Paused after 80 steps — Continue to let it go on" });
    expect(within(log()).queryByRole("alert")).toBeNull();
    const line = within(log()).getByText("Paused after 80 steps — Continue to let it go on").closest("[role=status]") as HTMLElement;
    expect(line).toBeTruthy();
    // The box is ready again; Stop is gone.
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    await act(async () => fireEvent.click(within(line).getByRole("button", { name: "Continue" })));
    expect(chat.continues).toEqual([id]);
    // The same answer goes on, under the turn the backend names; the line is gone.
    emit(id, { kind: "text", text: "And the rest." }, "turn-2");
    emit(id, { kind: "done" }, "turn-2");
    expect(within(log()).getAllByRole("article")).toHaveLength(1);
    expect(within(log()).getByText(/Working through it\. And the rest\./)).toBeTruthy();
    expect(within(log()).queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("offers Continue on the newest answer only", async () => {
    const { id, box } = await show();
    await ask(box, "First");
    emit(id, { kind: "paused", reason: "calls", detail: "Paused after 250 tool calls" });
    await ask(box, "Something else");
    emit(id, { kind: "done" }, "turn-2");
    expect(within(log()).queryByRole("button", { name: "Continue" })).toBeNull();
    expect(within(log()).getByText("Paused")).toBeTruthy();
  });
});

describe("a message sent while it works", () => {
  it("waits as a pending bubble, then joins the answer where the model took it up", async () => {
    const { id, box } = await show();
    await ask(box, "Tidy the deck");
    chat.queueNext();
    await ask(box, "Also fix the footer");
    const pending = within(log()).getByLabelText("Waiting to be sent");
    expect(within(pending).getByText("Also fix the footer")).toBeTruthy();
    expect(within(pending).getByText("Will be sent at the next step")).toBeTruthy();
    emit(id, { kind: "queued", text: "Also fix the footer", delivered: true });
    expect(within(log()).queryByLabelText("Waiting to be sent")).toBeNull();
    const taken = within(log()).getByText("Also fix the footer");
    expect(taken.closest(".kasten-chat-steer")).toBeTruthy();
  });
});

describe("the plan", () => {
  const plan = [
    { id: "1", text: "Read the deck", status: "done" },
    { id: "2", text: "Fix the titles", status: "doing" },
    { id: "3", text: "Run the lint", status: "todo" },
  ];

  it("is a small checklist above the answer, with its progress", async () => {
    const { id, box } = await show();
    await ask(box, "Tidy the deck");
    emit(id, { kind: "plan", plan });
    const list = within(log()).getByRole("list", { name: "Plan" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Read the deck (done)", "Fix the titles (in progress)", "Run the lint (to do)"]);
    expect(within(list).getByText(/Fix the titles/).closest("li")!.getAttribute("aria-current")).toBe("step");
    expect(within(log()).getByRole("button", { name: /Plan/ }).textContent).toContain("1 of 3 done");
    // Above the answer it belongs to.
    const answer = within(log()).getByRole("article");
    expect(list.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("folds away and stays folded, and goes when the assistant clears it", async () => {
    const { id, box } = await show();
    await ask(box, "Tidy the deck");
    emit(id, { kind: "plan", plan });
    fireEvent.click(within(log()).getByRole("button", { name: /Plan/ }));
    expect(within(log()).queryByRole("list", { name: "Plan" })).toBeNull();
    expect(localStorage.getItem("kasten.disclosure.chat-plan")).toBe("0");
    emit(id, { kind: "plan", plan: [] });
    expect(within(log()).queryByRole("button", { name: /Plan/ })).toBeNull();
  });
});

describe("a dropped connection", () => {
  it("is one quiet line that goes once the answer goes on", async () => {
    const { id, box } = await show();
    await ask(box, "Hello");
    emit(id, { kind: "notice", code: "retry", text: "Connection dropped, trying again (2 of 4)" });
    expect(within(log()).getByText("Connection dropped, trying again (2 of 4)").getAttribute("role")).toBe("status");
    emit(id, { kind: "notice", code: "retry", text: "Connection dropped, trying again (3 of 4)" });
    expect(within(log()).queryByText("Connection dropped, trying again (2 of 4)")).toBeNull();
    expect(within(log()).getByText("Connection dropped, trying again (3 of 4)")).toBeTruthy();
    emit(id, { kind: "text", text: "Back." });
    act(() => flushStream());
    expect(within(log()).queryByText(/Connection dropped/)).toBeNull();
  });
});

describe("the step", () => {
  it("is said quietly while it works and gone after", async () => {
    const { id, box } = await show();
    await ask(box, "Hello");
    emit(id, { kind: "round", n: 7, calls: 12 });
    expect(within(log()).getByText("Step 7")).toBeTruthy();
    emit(id, { kind: "done" });
    expect(within(log()).queryByText("Step 7")).toBeNull();
  });
});

describe("the list of threads", () => {
  it("says what each is doing, and marks one that finished while you were elsewhere", async () => {
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    await useChat.getState().loadProviders();
    const a = useChat.getState().start({ open: true });
    const b = useChat.getState().start();
    const c = useChat.getState().start();
    for (const [id, text] of [[a, "Alpha"], [b, "Beta"], [c, "Gamma"]] as const) await useChat.getState().send(id, text);
    // Beta pauses and Gamma is done while Alpha is the one in front.
    act(() => chat.emit({ chat: b, turn: "turn-2", kind: "paused", reason: "calls", detail: "Paused after 250 tool calls" }));
    act(() => chat.emit({ chat: c, turn: "turn-3", kind: "done" }));
    render(<ThreadList active={a} />);
    const list = screen.getByRole("complementary", { name: "Chats" });
    const row = (name: string) => within(list).getByRole("button", { name }).closest("li") as HTMLElement;
    expect(row("Alpha").textContent).toContain("Working");
    expect(row("Beta").textContent).toContain("Paused");
    expect(row("Gamma").textContent).toContain("Done");
    expect(within(row("Gamma")).getByRole("img", { name: "Not seen yet" })).toBeTruthy();
    // The state is in the name's description, not its name: the buttons keep their names.
    expect(within(list).getByRole("button", { name: "Beta" }).getAttribute("aria-description")).toBe("Paused");
    // Opened, it is seen: nothing says Done any more.
    act(() => void useUnread.getState().view(c));
    expect(row("Gamma").textContent).not.toContain("Done");
  });

  it("lists the chats kept from an earlier run, and opens one when it is pressed", async () => {
    chat.threadList = [{ id: "old", title: "Plan the trip", updated: 1_700_000_000_000, status: "interrupted", provider: "Claude", model: "model-small" }];
    chat.loads["old"] = {
      ui: { v: 1, messages: [{ id: "m1", role: "user", text: "Plan the trip", context: [] }, { id: "m2", role: "assistant", turn: "t", provider: "Claude", model: "m", parts: [{ kind: "text", text: "Here is a plan." }], status: "done", error: null, pinned: null }] },
      status: "interrupted",
      seq: 3,
      plan: [],
      title: "Plan the trip",
      provider: "Claude",
      model: "model-small",
      queued: [],
    };
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    await useChat.getState().loadProviders();
    const id = useChat.getState().start({ open: true });
    await useChat.getState().loadSaved();
    render(<ThreadList active={id} />);
    const list = screen.getByRole("complementary", { name: "Chats" });
    const kept = within(list).getByRole("button", { name: "Plan the trip" });
    expect(kept.closest("li")!.textContent).toContain("Interrupted");
    await act(async () => fireEvent.click(kept));
    await act(async () => {});
    expect(useChat.getState().active).toBe("old");
    expect(useChat.getState().threads["old"]!.messages).toHaveLength(2);
    expect(within(list).getByText("Chats are kept on this computer, not in your vault. Save one to keep it in chats/.")).toBeTruthy();
  });
});
