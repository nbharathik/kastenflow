// What the deck's assistant is doing, for the dot on the editor's Assistant button: it is read from the chat, so it shows with the
// panel closed and after the deck's tab was put away and brought back.

import type { AiStatus, AiStatusSource } from "@kasten-slides/react";

import { useChat } from "../chat/store";
import { threadStatus } from "../chat/thread";
import { useUnread } from "../chat/unread";
import { knownDeckThread } from "./ai-thread";

/** The status of the deck's chat: working (or in line to), paused or interrupted, failed while nobody has looked, otherwise at rest. */
export function deckAiStatus(deck: string): AiStatus {
  const id = knownDeckThread(deck);
  const thread = id ? useChat.getState().threads[id] : undefined;
  if (!id || !thread) return "idle";
  const status = threadStatus(thread);
  if (status === "working" || status === "waiting") return "working";
  if (status === "paused" || status === "interrupted") return "paused";
  // A failure is shown until the chat is looked at (the assistant tab being open is looking at it).
  if (status === "failed" && useUnread.getState().unseen[id] === "failed") return "failed";
  return "idle";
}

/** The deck's assistant status as the editor's host gives it. */
export function deckAiSource(deck: string): AiStatusSource {
  return {
    current: () => deckAiStatus(deck),
    subscribe(listener) {
      const stops = [useChat.subscribe(listener), useUnread.subscribe(listener)];
      return () => stops.forEach((stop) => stop());
    },
  };
}
