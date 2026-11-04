import type { AiRequest } from "@kasten-slides/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, threadOfDeck } = vi.hoisted(() => ({ send: vi.fn(), threadOfDeck: vi.fn(() => "t-1") }));
vi.mock("../chat/store", () => ({ useChat: { getState: () => ({ send }) } }));
vi.mock("./ai-thread", () => ({ threadOfDeck }));

import { editorAi } from "./editor-ai";

const request: AiRequest = { task: "shorten", prompt: "Shorten the text on slide 2.", deckPath: "projects/Talks/decks/a.deck", slideId: "s-1", elementIds: ["e-1"] };

beforeEach(() => {
  send.mockReset();
  threadOfDeck.mockClear();
});

describe("the editor's assistant", () => {
  it("gives the request to the deck's own chat thread, as the person's message", async () => {
    send.mockResolvedValue(true);
    const outcome = await editorAi("projects/Talks/decks/a.deck").ai?.ask(request);
    expect(outcome).toEqual({ status: "sent" });
    expect(threadOfDeck).toHaveBeenCalledWith("projects/Talks/decks/a.deck");
    expect(send).toHaveBeenCalledWith("t-1", request.prompt);
  });

  it("says why when the chat would not take it", async () => {
    send.mockResolvedValue(false);
    const outcome = await editorAi("a.deck").ai?.ask(request);
    expect(outcome?.status).toBe("refused");
    expect(outcome && "message" in outcome && outcome.message).toMatch(/provider/);
  });

  it("says why when sending fails", async () => {
    send.mockRejectedValue(new Error("No network."));
    expect(await editorAi("a.deck").ai?.ask(request)).toEqual({ status: "refused", message: "No network." });
  });

  it("is not offered for a deck kept nowhere", () => {
    expect(editorAi("")).toEqual({});
  });
});
