// The editor's assistant tab: one thread for each deck, a chip that follows the slide and the selection, and
// the way to accept what the assistant made.

import type { AiPanelProps } from "@kasten-slides/react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChat } from "../chat/store";
import { resetChat, scriptedChat, type Scripted } from "../chat/test-kit";
import { AiTab } from "./AiTab";
import { slideChip } from "./ai-thread";

const DECK = "library/talk.deck";

function props(over: Partial<AiPanelProps> = {}): AiPanelProps {
  return {
    deckPath: DECK,
    deckTitle: "Tool use",
    theme: "Light",
    slideId: "s2",
    slideNumber: 2,
    slideCount: 6,
    slideTitle: "The loop",
    elementIds: [],
    pending: 0,
    acceptAll: () => {},
    ...over,
  };
}

let chat: Scripted;

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat();
  resetChat(chat);
});
afterEach(cleanup);

const chips = () => screen.getByRole("group", { name: "Context" });
const chipLabels = () => Array.from(chips().querySelectorAll(".kasten-chat-chip-label")).map((n) => n.textContent);

async function ask(text: string) {
  const box = await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
}

/** The assistant answers the last question and is done. */
function answered(reply: string) {
  const id = useChat.getState().order[useChat.getState().order.length - 1]!;
  const turn = `turn-${chat.requests.length}`;
  act(() => {
    chat.emit({ chat: id, turn, kind: "text", text: reply });
    chat.emit({ chat: id, turn, kind: "done" });
  });
}

const log = () => screen.getByRole("log", { name: "Messages" });

describe("the chip of a slide", () => {
  it("names the deck, the slide and what is selected, so the backend can read them", () => {
    expect(slideChip(props({ elementIds: ["e1", "e2"] }))).toEqual({
      kind: "slide",
      label: "Slide 2: The loop · 2 selected",
      ref: [DECK, "s2", "e1", "e2"],
    });
    expect(slideChip(props({ elementIds: ["e1"] })).label).toBe("Slide 2: The loop · 1 selected");
    expect(slideChip(props({ slideTitle: "A very long title that would fill the whole of the row" })).label).toBe("Slide 2: A very long title that woul…");
  });
});

describe("the assistant tab", () => {
  it("is a chat about this slide: the chip goes with the message", async () => {
    render(<AiTab {...props({ elementIds: ["e7"] })} />);
    await screen.findByRole("heading", { name: "Ask for a change to the deck" });
    expect(chipLabels()).toEqual(["Slide 2: The loop · 1 selected"]);
    await ask("Tighten this");
    expect(chat.requests).toHaveLength(1);
    expect(chat.requests[0]!.context).toEqual([{ kind: "slide", label: "Slide 2: The loop · 1 selected", ref: [DECK, "s2", "e7"] }]);
  });

  it("has no Follow active page switch: it follows the slide, not a page", async () => {
    render(<AiTab {...props()} />);
    await screen.findByRole("textbox", { name: "Message" });
    expect(screen.queryByRole("switch", { name: "Follow active page" })).toBeNull();
  });

  it("follows the slide and the selection: the chip is replaced, never piled up", async () => {
    const view = render(<AiTab {...props()} />);
    await screen.findByRole("textbox", { name: "Message" });
    expect(chipLabels()).toEqual(["Slide 2: The loop"]);
    view.rerender(<AiTab {...props({ slideId: "s3", slideNumber: 3, slideTitle: "Why it matters" })} />);
    await expect.poll(chipLabels).toEqual(["Slide 3: Why it matters"]);
    view.rerender(<AiTab {...props({ slideId: "s3", slideNumber: 3, slideTitle: "Why it matters", elementIds: ["a", "b"] })} />);
    await expect.poll(chipLabels).toEqual(["Slide 3: Why it matters · 2 selected"]);
    // The deck changing under the same slide and selection does not put the chip back.
    await act(async () => fireEvent.click(within(chips()).getByRole("button", { name: /^Remove Slide 3/ })));
    expect(chipLabels()).toEqual([]);
    view.rerender(<AiTab {...props({ slideId: "s3", slideNumber: 3, slideTitle: "Why it matters", elementIds: ["a", "b"], pending: 3 })} />);
    await act(async () => {});
    expect(chipLabels()).toEqual([]);
    // Another slide does.
    view.rerender(<AiTab {...props({ slideId: "s4", slideNumber: 4, slideTitle: "Where it fails" })} />);
    await expect.poll(chipLabels).toEqual(["Slide 4: Where it fails"]);
  });

  it("keeps one thread for each deck, and leaves its chip out of the thread when the tab goes", async () => {
    const view = render(<AiTab {...props()} />);
    await ask("First question");
    answered("Done.");
    const [id] = useChat.getState().order;
    expect(useChat.getState().threads[id!]!.messages).toHaveLength(2);
    view.unmount();
    expect(useChat.getState().threads[id!]!.context).toEqual([]);
    render(<AiTab {...props({ slideId: "s5", slideNumber: 5, slideTitle: "Summary" })} />);
    await within(log()).findByText("First question");
    expect(useChat.getState().order).toEqual([id]);
    expect(chipLabels()).toEqual(["Slide 5: Summary"]);
  });

  it("starts another thread on request, and another deck has its own", async () => {
    const view = render(<AiTab {...props()} />);
    await ask("First question");
    expect(screen.getByRole("button", { name: "New chat" }).hasAttribute("disabled")).toBe(true);
    answered("Done.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New chat" })));
    await screen.findByRole("heading", { name: "Ask for a change to the deck" });
    expect(screen.queryByText("First question")).toBeNull();
    expect(chat.resets).toHaveLength(1);
    view.rerender(<AiTab {...props({ deckPath: "library/other.deck" })} />);
    await screen.findByRole("heading", { name: "Ask for a change to the deck" });
    expect(chipLabels()).toEqual(["Slide 2: The loop"]);
    expect(useChat.getState().order).toHaveLength(2);
  });

  it("says what waits for the person's look, and accepts it all from there", async () => {
    const acceptAll = vi.fn();
    const view = render(<AiTab {...props({ pending: 1, acceptAll })} />);
    const bar = await screen.findByRole("status");
    expect(bar.textContent).toContain("1 element is the assistant’s, not accepted yet");
    view.rerender(<AiTab {...props({ pending: 4, acceptAll })} />);
    expect(screen.getByRole("status").textContent).toContain("4 elements are the assistant’s, not accepted yet");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Accept all" }));
    expect(acceptAll).toHaveBeenCalledOnce();
    view.rerender(<AiTab {...props({ pending: 0, acceptAll })} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("brings back a deck's chat from an earlier run, and makes a new one when it is gone", async () => {
    localStorage.setItem("kasten.chat.decks", JSON.stringify({ [DECK]: "old", "library/lost.deck": "lost" }));
    const ui = {
      v: 1,
      id: "old",
      created: 1,
      provider: "Claude",
      model: "model-small",
      context: [],
      messages: [
        { id: "m1", role: "user", text: "Earlier question", context: [] },
        { id: "m2", role: "assistant", turn: "t1", provider: "Claude", model: "model-small", parts: [{ kind: "text", text: "Earlier answer" }], status: "done", error: null, pinned: null },
      ],
      session: "s",
      changed: false,
      undone: false,
      seq: 2,
    };
    chat.loads["old"] = { ui, status: "idle", seq: 2, plan: [], title: "Earlier question", provider: "Claude", model: "model-small", queued: [] };
    const view = render(<AiTab {...props()} />);
    await within(await screen.findByRole("log", { name: "Messages" })).findByText("Earlier question");
    expect(useChat.getState().active).toBeNull();
    expect(useChat.getState().order).toEqual(["old"]);
    // A chat that is not there any more is a new thread.
    view.rerender(<AiTab {...props({ deckPath: "library/lost.deck" })} />);
    await screen.findByRole("heading", { name: "Ask for a change to the deck" });
    expect(useChat.getState().order).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("kasten.chat.decks")!)["library/lost.deck"]).not.toBe("lost");
  });

  it("says what the assistant is doing, and not what it has finished", async () => {
    render(<AiTab {...props()} />);
    await ask("Tidy the deck");
    const id = useChat.getState().order[0]!;
    const says = (word: string) => screen.queryAllByRole("status").some((n) => n.textContent?.includes(word));
    expect(says("Working")).toBe(true);
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "paused", reason: "rounds", detail: "Paused after 80 steps" }));
    expect(says("Paused")).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue" })));
    expect(chat.continues).toEqual([id]);
    act(() => chat.emit({ chat: id, turn: "turn-2", kind: "done" }));
    expect(says("Working")).toBe(false);
    expect(says("Done")).toBe(false);
  });

  it("works on decks kept in the vault only", () => {
    render(<AiTab {...props({ deckPath: undefined })} />);
    expect(screen.getByText("The assistant works on decks kept in the vault.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  });
});
