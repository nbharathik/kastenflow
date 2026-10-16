// The link between the audience's window and the presenter's. Each window says where it is whenever that changes,
// and moves to where the other says; so either can drive, and nothing decides which is in charge. What travels
// is reveal.js's own state (`getState()` and `setState()`), the deck once when the presenter's window asks for it,
// and a word when a window closes.

import type { Deck } from "@kasten-slides/wasm";

import type { RevealState } from "./plan.ts";

export type PresentMessage =
  /** The presenter's window has opened and wants the deck. */
  | { type: "hello" }
  /** The deck as the audience sees it, the addresses of its pictures, and where the audience is. `since` is when the presentation began (milliseconds). */
  | { type: "deck"; deck: Deck; images: Record<string, string>; state: RevealState; since: number }
  | { type: "state"; state: RevealState }
  /** The talk was started as a rehearsal: the presenter's view starts timing it. Said again with every deck, so a window that opens late hears it. */
  | { type: "rehearse" }
  | { type: "bye" };

export interface PresentSync {
  post(message: PresentMessage): void;
  /** Listens for what the other window says; returns how to stop. */
  subscribe(listener: (message: PresentMessage) => void): () => void;
  close(): void;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A message from the other window, or null when what came is not one (a window can be sent anything by a page of the same address). */
export function readMessage(data: unknown): PresentMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case "hello":
    case "rehearse":
    case "bye":
      return { type: message.type };
    case "state": {
      const state = readState(message.state);
      return state ? { type: "state", state } : null;
    }
    case "deck": {
      const state = readState(message.state);
      const deck = message.deck as Deck | undefined;
      if (!state || !deck || !Array.isArray(deck.slides) || typeof message.images !== "object" || message.images === null || !isNumber(message.since)) return null;
      return { type: "deck", deck, images: message.images as Record<string, string>, state, since: message.since };
    }
    default:
      return null;
  }
}

function readState(value: unknown): RevealState | null {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Record<string, unknown>;
  if (!isNumber(state.indexh) || !isNumber(state.indexv)) return null;
  return {
    indexh: state.indexh,
    indexv: state.indexv,
    ...(isNumber(state.indexf) ? { indexf: state.indexf } : {}),
    ...(typeof state.paused === "boolean" ? { paused: state.paused } : {}),
    ...(typeof state.overview === "boolean" ? { overview: state.overview } : {}),
  };
}

/** Two windows of the same address, joined by a named channel. */
export function broadcastSync(name: string): PresentSync {
  const channel = new BroadcastChannel(`kasten-slides-present:${name}`);
  return {
    post: (message) => channel.postMessage(message),
    subscribe(listener) {
      const receive = (event: MessageEvent) => {
        const message = readMessage(event.data);
        if (message) listener(message);
      };
      channel.addEventListener("message", receive);
      return () => channel.removeEventListener("message", receive);
    },
    close: () => channel.close(),
  };
}

/** Two ends of a link inside one page, for tests. What one posts the other hears (after the current task, as a window would). */
export function memorySyncPair(): [PresentSync, PresentSync] {
  const listeners: [Set<(m: PresentMessage) => void>, Set<(m: PresentMessage) => void>] = [new Set(), new Set()];
  const end = (mine: 0 | 1): PresentSync => ({
    post(message) {
      const copy = readMessage(structuredClone(message));
      if (copy) queueMicrotask(() => listeners[mine === 0 ? 1 : 0].forEach((listener) => listener(copy)));
    },
    subscribe(listener) {
      listeners[mine].add(listener);
      return () => void listeners[mine].delete(listener);
    },
    close: () => listeners[mine].clear(),
  });
  return [end(0), end(1)];
}
