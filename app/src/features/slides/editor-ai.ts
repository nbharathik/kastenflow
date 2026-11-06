// Help from the assistant inside the Slides editor (Tools → Write with AI): the editor works out the request, and this sends it to the
// deck's own chat thread, the one the editor's assistant tab shows. The assistant then changes the deck with its deck tools, so what it
// does is marked for the person, waits for review where the mode says so, and is undone like any of its work.

import type { AiOutcome, AiRequest, EditorAiHost } from "@kasten-slides/react";

import { useChat } from "../chat/store";
import { threadOfDeck } from "./ai-thread";

/** The editor's assistant for the deck at `path`; none when the deck is kept nowhere (the assistant works on decks in the vault). */
export function editorAi(path: string): { ai?: EditorAiHost } {
  if (!path) return {};
  return {
    ai: {
      async ask(request: AiRequest): Promise<AiOutcome> {
        try {
          const sent = await useChat.getState().send(threadOfDeck(path), request.prompt);
          return sent ? { status: "sent" } : { status: "refused", message: "The assistant could not take that. Check that an AI provider is set up in Settings." };
        } catch (error) {
          return { status: "refused", message: error instanceof Error ? error.message : "The assistant could not take that." };
        }
      },
    },
  };
}
