// What an empty thread shows: how to set up a provider when there is none,
// else what the chat can do, with a few questions to start from.

import { openProviders } from "../actions";
import type { Thread } from "../thread";
import { useChatLinks } from "./links";
import { Icon } from "../../../ui/Icon";

/** No provider to answer; `problem` when they could not even be read. */
export function NoProvider({ problem }: { problem: string | null }) {
  return (
    <div className="kasten-chat-empty">
      <span className="kasten-chat-empty-icon" aria-hidden="true">
        <Icon name="chat" className="size-6" />
      </span>
      <h2>{problem ? "The AI providers could not be read" : "Chat needs an AI provider"}</h2>
      <p>{problem ?? "Add the Anthropic API, any OpenAI-compatible server such as a local vLLM server, or sign in with ChatGPT to use your plan. Keys stay in your system keychain, never in the vault."}</p>
      <button type="button" className="kasten-chat-primary" onClick={() => openProviders("here")}>
        Set up in Settings → AI providers
      </button>
    </div>
  );
}

/** Questions to start from, for what the thread is grounded in. */
function suggestions(thread: Thread): string[] {
  const page = thread.context.find((c) => c.kind === "note");
  if (page) return [`Summarise “${page.label}” in five bullet points`, `Suggest tags and links for “${page.label}”`, `Make a card about the open questions in “${page.label}”`];
  const board = thread.context.find((c) => c.kind === "board");
  if (board) return [`What themes run through “${board.label}”?`, `Brainstorm five more ideas for “${board.label}”`, "Make a card about what is missing"];
  return ["What did I write about this week?", "Make a card about hotel ideas", "Brainstorm five ideas for my next project"];
}

export function Welcome({ thread, onPick }: { thread: Thread; onPick: (text: string) => void }) {
  const dock = useChatLinks().variant === "dock";
  return (
    <div className="kasten-chat-empty">
      {!dock && (
        <span className="kasten-chat-empty-icon" aria-hidden="true">
          <Icon name="chat" className="size-6" />
        </span>
      )}
      <h2>{dock ? "Ask about what is open" : "Ask about your notes"}</h2>
      <p>
        {dock
          ? "The chat reads the pages you have open, and follows as you open more. It can write pages, fill boards and make templates; everything it changes can be undone."
          : "Ground the chat in a page, a board, a tag view or search results with +\u00a0Context. It can create cards, fill boards and edit sections, and everything it changes can be undone."}
      </p>
      <div className="kasten-chat-suggestions" role="group" aria-label="Start with">
        {suggestions(thread).map((text) => (
          <button key={text} type="button" onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
