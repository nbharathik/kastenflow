// Two small pieces of state the comments share between the panel and the slide, kept beside the session and not in it (they are the window's,
// not the deck's): which comment the person is looking at, and whether the next press on the slide pins a comment there.

import { useSyncExternalStore } from "react";

import type { EditorSession } from "../session/session.ts";

interface Store {
  /** The comment the panel and the marker point at. */
  focused: string | null;
  /** The words of a comment waiting for a spot on the slide; null when no press is awaited. */
  pinning: string | null;
  listeners: Set<() => void>;
}

const stores = new WeakMap<EditorSession, Store>();

function storeOf(session: EditorSession): Store {
  let store = stores.get(session);
  if (!store) {
    store = { focused: null, pinning: null, listeners: new Set() };
    stores.set(session, store);
  }
  return store;
}

function change(session: EditorSession, apply: (store: Store) => void): void {
  const store = storeOf(session);
  apply(store);
  for (const listener of [...store.listeners]) listener();
}

const subscribeTo = (session: EditorSession) => (listener: () => void) => {
  const { listeners } = storeOf(session);
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The comment being looked at, or null. */
export function useFocusedComment(session: EditorSession): string | null {
  return useSyncExternalStore(subscribeTo(session), () => storeOf(session).focused);
}

export function focusComment(session: EditorSession, id: string | null): void {
  change(session, (store) => void (store.focused = id));
}

/** The words waiting for a spot, or null. */
export function usePinning(session: EditorSession): string | null {
  return useSyncExternalStore(subscribeTo(session), () => storeOf(session).pinning);
}

export function startPinning(session: EditorSession, words: string): void {
  change(session, (store) => void (store.pinning = words));
}

export function stopPinning(session: EditorSession): void {
  change(session, (store) => void (store.pinning = null));
}
