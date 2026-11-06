// The coding agents in the chat: a thread picks Claude Code or OpenCode by name,
// what the program does arrives as the chat's own events (text, folded tool
// steps, cards that ask), a card is answered with Allow or Deny, and a missing
// or failing program says so with the way on.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  answerApproval: vi.fn(async () => true),
  listAgents: vi.fn(async () => []),
  testAgent: vi.fn(),
}));
vi.mock("../actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../actions")>()),
  openAgents: vi.fn(),
}));

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { openAgents } from "../actions";
import { chatModelFor, lastModel, modelFor } from "../prefs";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { applyEvent, isEmptyAnswer, newThread, startTurn, type Answer } from "../thread";
import { transcript } from "../transcript";
import type { ChatEvent, ChatProvider } from "../types";
import { Conversation } from "../view/Conversation";
import { answerApproval } from "./client";
import { agentId, isAgentProvider } from "./names";
import type { Approval } from "./types";

const CODE: ChatProvider = { name: "Claude Code (CLI)", kind: "cli", baseUrl: "", model: "", hasKey: true, confirmed: true };
const OPEN: ChatProvider = { name: "OpenCode (CLI)", kind: "cli", baseUrl: "", model: "", hasKey: false, confirmed: true };

const ASK: Approval = { id: "req_1", agent: "Claude Code", tool: "Bash", question: "Allow Claude Code to run a command?", detail: "npm test", state: "asking" };

let chat: Scripted;

async function show(providers: ChatProvider[]) {
  chat = scriptedChat(providers);
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

const send = async (box: HTMLElement, text: string) => {
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
};

const pickAgent = async (label: string, name: string) => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: label })));
  const menu = screen.getByRole("dialog", { name: "Provider and model" });
  await act(async () => fireEvent.click(within(menu).getByRole("radio", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })));
};

const event = (id: string, partial: Partial<ChatEvent> & Pick<ChatEvent, "kind">): ChatEvent => ({ chat: id, turn: "turn-1", ...partial });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(answerApproval).mockReset().mockResolvedValue(true);
  vi.mocked(openAgents).mockClear();
});
afterEach(cleanup);

describe("choosing an agent for a thread", () => {
  it("lists the agents after the providers, says which are installed, and sends the thread to the one picked", async () => {
    const { id, box } = await show([CLAUDE, CODE, OPEN]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Model: Claude, model-small" })));
    const menu = screen.getByRole("dialog", { name: "Provider and model" });
    const names = within(menu)
      .getAllByRole("radio")
      .map((r) => r.textContent);
    expect(names[0]).toContain("Claude");
    expect(names[1]).toContain("Claude Code (CLI)");
    expect(names[1]).toContain("your own account");
    expect(names[2]).toContain("OpenCode (CLI)");
    expect(names[2]).toContain("not installed");
    await act(async () => fireEvent.click(within(menu).getAllByRole("radio")[1]!));

    // The header is the agent's name; there is no model list and no generation settings for it.
    expect(screen.getByRole("button", { name: "Agent: Claude Code (CLI)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generation settings" })).toBeNull();
    expect(useChat.getState().threads[id]?.provider).toBe("Claude Code (CLI)");

    await send(box, "Read my hotel note");
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]).toMatchObject({ chat: id, provider: "Claude Code (CLI)", model: "", text: "Read my hotel note" });
    expect(chat.requests[0]!.settings).toBeUndefined();
    // An agent is a thread's own choice: new chats still start with the model that was used.
    expect(lastModel()?.provider).not.toBe("Claude Code (CLI)");
  });

  it("is never the fallback of the page editor, brainstorms and the rest, which ask a model", () => {
    const providers = [CODE, CLAUDE];
    expect(modelFor({ provider: null, model: null }, providers)?.provider).toBe("Claude");
    expect(modelFor({ provider: "Claude Code (CLI)", model: null }, providers)?.provider).toBe("Claude");
    expect(modelFor({ provider: null, model: null }, [CODE, OPEN])).toBeNull();
    expect(chatModelFor({ provider: "Claude Code (CLI)", model: null }, providers)?.provider).toBe("Claude Code (CLI)");
    // A chat with no provider at all falls to an agent that is installed, not to one that is missing.
    expect(chatModelFor({ provider: null, model: null }, [OPEN, CODE])?.provider).toBe("Claude Code (CLI)");
    expect(chatModelFor({ provider: null, model: null }, [OPEN])).toBeNull();
  });

  it("knows the agents by name", () => {
    expect(isAgentProvider("Claude Code (CLI)") && isAgentProvider("OpenCode (CLI)")).toBe(true);
    expect(isAgentProvider("Claude") || isAgentProvider(null)).toBe(false);
    expect(agentId("OpenCode (CLI)")).toBe("opencode");
  });
});

describe("what an agent does shows as the chat's own answer", () => {
  it("streams text and tool steps, asks with a card, and the answer to the card goes to the program", async () => {
    const { id, box } = await show([CLAUDE, CODE]);
    await pickAgent("Model: Claude, model-small", "Claude Code (CLI)");
    await send(box, "Run the tests");
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    await act(async () => {
      chat.emit(event(id, { kind: "text", text: "I will run them. " }));
      chat.emit(event(id, { kind: "tool", tool: { id: "t1", name: "read_note", input: { path: "inbox/a.md" } } }));
      chat.emit(event(id, { kind: "toolResult", result: { id: "t1", ok: true, summary: "Read “Hotel ideas”", paths: ["inbox/a.md"] } }));
      chat.emit(event(id, { kind: "approval", approval: ASK }));
    });
    await screen.findByText("I will run them.");
    expect(await screen.findByText("Read “Hotel ideas”")).toBeTruthy();
    const card = await screen.findByRole("group", { name: "Allow Claude Code to run a command?" });
    expect(within(card).getByText("npm test")).toBeTruthy();

    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Allow" })));
    expect(answerApproval).toHaveBeenCalledWith(id, "req_1", true);
    // The program's side tells how it went; the card follows.
    await act(async () => chat.emit(event(id, { kind: "approval", approval: { ...ASK, state: "allowed" } })));
    expect(within(await screen.findByRole("group", { name: ASK.question })).getByText("Allowed")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: ASK.question })).queryByRole("button", { name: "Allow" })).toBeNull();
  });

  it("passes Deny on, and a card whose question is gone says so instead of pretending", async () => {
    const { id, box } = await show([CLAUDE, CODE]);
    await pickAgent("Model: Claude, model-small", "Claude Code (CLI)");
    await send(box, "Go");
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    await act(async () => chat.emit(event(id, { kind: "approval", approval: ASK })));
    vi.mocked(answerApproval).mockResolvedValueOnce(false);
    const card = await screen.findByRole("group", { name: ASK.question });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Deny" })));
    expect(answerApproval).toHaveBeenCalledWith(id, "req_1", false);
    expect(await within(card).findByText("No longer asked")).toBeTruthy();
  });

  it("can be used from the keyboard alone: both buttons are reachable and Enter presses the focused one", async () => {
    const { id, box } = await show([CLAUDE, CODE]);
    await pickAgent("Model: Claude, model-small", "Claude Code (CLI)");
    await send(box, "Go");
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    await act(async () => chat.emit(event(id, { kind: "approval", approval: ASK })));
    const card = await screen.findByRole("group", { name: ASK.question });
    const buttons = within(card).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Allow", "Deny"]);
    expect(buttons.every((b) => b.tabIndex >= 0)).toBe(true);
    buttons[0]!.focus();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("says in the CLI's own words that it is not signed in or not installed, and leads to the Agents settings", async () => {
    const { id, box } = await show([CLAUDE, OPEN]);
    await pickAgent("Model: Claude, model-small", "OpenCode (CLI)");
    chat.failNext("OpenCode was not found on this computer, so this chat cannot use it. Install OpenCode, then open a new KastenFlow chat.");
    await send(box, "Hello");
    expect(await screen.findByText(/OpenCode was not found on this computer/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open Agents settings" })));
    expect(openAgents).toHaveBeenCalledWith("here");
    expect(useChat.getState().threads[id]?.messages.at(-1)).toMatchObject({ role: "assistant", status: "error" });
  });

  it("shows no 'undo this chat' bar for an agent's thread: its changes are in a session of its own", async () => {
    const { id, box } = await show([CLAUDE, CODE]);
    await pickAgent("Model: Claude, model-small", "Claude Code (CLI)");
    await send(box, "Add a card");
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    await act(async () => {
      chat.emit(event(id, { kind: "tool", tool: { id: "t1", name: "capture", input: {} } }));
      chat.emit(event(id, { kind: "toolResult", result: { id: "t1", ok: true, summary: "Captured a card", paths: ["inbox/x.md"] } }));
      chat.emit(event(id, { kind: "done" }));
    });
    await screen.findByText("Captured a card");
    expect(useChat.getState().threads[id]?.changed).toBe(true);
    expect(screen.queryByRole("region", { name: "This chat's changes" })).toBeNull();
  });
});

describe("the thread keeps a card up to date", () => {
  const streaming = (): { thread: ReturnType<typeof newThread>; answer: () => Answer } => {
    const thread = startTurn(newThread({ id: "c" }), "Run the tests", "Claude Code (CLI)", "");
    return { thread, answer: () => thread.messages.at(-1) as Answer };
  };

  it("adds one card per question and updates it in place when it is answered or ends", () => {
    let { thread } = streaming();
    thread = applyEvent(thread, event("c", { kind: "approval", approval: ASK }));
    thread = applyEvent(thread, event("c", { kind: "approval", approval: { ...ASK, id: "req_2", question: "Allow Claude Code to use the web?" } }));
    thread = applyEvent(thread, event("c", { kind: "approval", approval: { ...ASK, state: "denied" } }));
    const parts = (thread.messages.at(-1) as Answer).parts;
    expect(parts.map((p) => (p.kind === "approval" ? `${p.ask.id}:${p.ask.state}` : p.kind))).toEqual(["req_1:denied", "req_2:asking"]);
  });

  it("is part of the transcript in words", () => {
    let { thread } = streaming();
    thread = applyEvent(thread, event("c", { kind: "approval", approval: { ...ASK, state: "allowed" } }));
    const text = transcript(thread, { notes: [], boards: [] });
    expect(text).toContain("Allow Claude Code to run a command? (allowed)");
  });

  it("keeps an answer with only a card from being called empty", () => {
    let { thread } = streaming();
    thread = applyEvent(thread, event("c", { kind: "approval", approval: ASK }));
    thread = applyEvent(thread, event("c", { kind: "done" }));
    const last = thread.messages.at(-1) as Answer;
    expect(last.status).toBe("done");
    expect(last.parts).toHaveLength(1);
    expect(isEmptyAnswer(last)).toBe(false);
  });
});
