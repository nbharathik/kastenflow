import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, LOCAL, type Scripted } from "../test-kit";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";

let chat: Scripted;

async function show() {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE, LOCAL]);
  resetChat(chat);
});
afterEach(cleanup);

describe("a steady message box", () => {
  it("stays three rows tall however much is typed: nothing measures it or sets its height", async () => {
    const { box } = await show();
    expect(box.rows).toBe(3);
    expect(box.style.height).toBe("");
    for (let lines = 1; lines <= 10; lines++) {
      type(box, Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join("\n"));
      expect(box.style.height).toBe("");
      expect(box.rows).toBe(3);
    }
    type(box, "x".repeat(5000));
    expect(box.style.height).toBe("");
    type(box, "");
    expect(box.style.height).toBe("");
  });

  it("keeps its bar when there is no model picker, with Send at the end", async () => {
    resetChat(scriptedChat([]));
    const { box } = await show();
    const bar = box.closest("form")!.querySelector(".kasten-chat-composer-bar");
    expect(bar).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Model:/ })).toBeNull();
    expect(bar!.querySelector(".kasten-chat-send")).toBeTruthy();
  });

  it("puts the Follow active page switch in the bar, beside Send, and not among the chips", async () => {
    const { box } = await show();
    const form = box.closest("form")!;
    const bar = form.querySelector(".kasten-chat-composer-bar")!;
    const follow = within(form).getByRole("switch", { name: "Follow active page" });
    expect(bar.contains(follow)).toBe(true);
    expect(within(screen.getByRole("group", { name: "Context" })).queryByRole("switch")).toBeNull();
    expect(follow.getAttribute("aria-checked")).toBe("true");
  });

  it("leaves the switch out where it does nothing", async () => {
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    await useChat.getState().loadProviders();
    const id = useChat.getState().start({ open: true });
    render(<Composer id={id} page={null} showFollow={false} />);
    expect(screen.queryByRole("switch", { name: "Follow active page" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
  });
});

describe("Composer", () => {
  it("sends with Enter and starts a new line with Shift+Enter", async () => {
    const { box } = await show();
    type(box, "First line");
    expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(true);
    // Enter while an input method composes a word only ends the word.
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(chat.requests).toHaveLength(0);
    type(box, "   ");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests).toHaveLength(0);
    type(box, "First line\nSecond line");
    await act(async () => {
      expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    });
    expect(chat.requests.map((r) => r.text)).toEqual(["First line\nSecond line"]);
    expect(box.value).toBe("");
    expect(screen.getByRole("log").textContent).toContain("First line\nSecond line");
  });

  it("offers Stop beside Send while an answer streams, and queues what is sent meanwhile", async () => {
    const { id, box } = await show();
    type(box, "Write a poem");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    // Stop appears; Send stays, for the model's next step.
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    chat.queueNext();
    type(box, "Next question");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests.map((r) => r.text)).toEqual(["Write a poem", "Next question"]);
    expect(box.value).toBe("");
    // It waits as a pending bubble, not as a question of its own.
    expect(screen.getByText("Next question")).toBeTruthy();
    expect(screen.getByText("Will be sent at the next step")).toBeTruthy();
    expect(useChat.getState().threads[id]!.messages).toHaveLength(2);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));
    expect(chat.stops).toEqual([id]);
    expect(screen.getByRole("button", { name: "Stopping…" })).toHaveProperty("disabled", true);
    // Nothing is sent while Stop is waited for.
    type(box, "Never mind");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done", stopped: true }));
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
    // What waited for a step that will not come is gone.
    expect(screen.queryByText("Will be sent at the next step")).toBeNull();
  });

  it("keeps each thread's draft", async () => {
    const { id, box } = await show();
    type(box, "Half a thought");
    const other = useChat.getState().start({ open: true });
    cleanup();
    render(<Conversation id={other} variant="full" page={null} />);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("");
    cleanup();
    render(<Conversation id={id} variant="full" page={null} />);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Half a thought");
  });

  it("picks the provider and types the model per thread", async () => {
    const { box } = await show();
    fireEvent.click(screen.getByRole("button", { name: "Model: Claude, model-small" }));
    const menu = screen.getByRole("dialog", { name: "Provider and model" });
    fireEvent.click(within(menu).getByRole("radio", { name: /Local server/ }));
    const model = within(screen.getByRole("dialog", { name: "Provider and model" })).getByRole("textbox", { name: "Model" }) as HTMLInputElement;
    expect(model.value).toBe("local-model");
    fireEvent.change(model, { target: { value: "local-model" } });
    fireEvent.keyDown(model, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Model: Local server, local-model" })).toBeTruthy();
    type(box, "Hello");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests[0]).toMatchObject({ provider: "Local server", model: "local-model" });
  });

  it("is off, and says why, without a provider", async () => {
    resetChat(scriptedChat([]));
    const { box } = await show();
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe("Add an AI provider in Settings to chat");
    expect(screen.queryByRole("button", { name: /^Model:/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds a page to the context when @ or [[ is typed", async () => {
    await useWorkspace.getState().connect({ client: new MemoryVault({ "library/trip.md": "---\ntitle: Trip plans\n---\nTrain.\n" }) });
    await useChat.getState().loadProviders();
    const id = useChat.getState().start({ open: true });
    render(<Conversation id={id} variant="full" page={null} />);
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    type(box, "Sum up @");
    const pick = screen.getByRole("dialog", { name: "Add a page or card" });
    fireEvent.change(within(pick).getByRole("textbox", { name: "Find a page or card" }), { target: { value: "trip" } });
    await act(async () => fireEvent.keyDown(within(pick).getByRole("textbox", { name: "Find a page or card" }), { key: "Enter" }));
    expect(screen.queryByRole("dialog", { name: "Add a page or card" })).toBeNull();
    expect(useChat.getState().threads[id]!.context.map((c) => c.label)).toEqual(["Trip plans"]);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Sum up ");
    // An e-mail address is not a mention.
    type(box, "Mail me@");
    expect(screen.queryByRole("dialog", { name: "Add a page or card" })).toBeNull();
  });
});
