// Which web page is open in the editor's peek, if any. A tiny store of its own (the editor's window state is not changed for it): the
// peek is opened by a command or by the chip over a selected embed and drawn by `EditorWebPreview`. One page at a time; opening another
// address navigates the peek that is open.

import { openInWindow } from "../../pages/follow.ts";
import type { EditorSession } from "../session/session.ts";

export class PreviewStore {
  private address: string | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): string | null => this.address;

  open(address: string): void {
    if (address === this.address) return;
    this.address = address;
    for (const listener of [...this.listeners]) listener();
  }

  close(): void {
    if (this.address === null) return;
    this.address = null;
    for (const listener of [...this.listeners]) listener();
  }
}

const stores = new WeakMap<EditorSession, PreviewStore>();

/** The peek of this editor. */
export function previewOf(session: EditorSession): PreviewStore {
  let store = stores.get(session);
  if (!store) {
    store = new PreviewStore();
    stores.set(session, store);
  }
  return store;
}

/**
 * Previews a web address live: in the peek beside the slide where the host has one, else in the person's own browser (the host's way of
 * opening an address, or a window that shares nothing with the page).
 */
export function openPreview(session: EditorSession, address: string): void {
  const { host } = session;
  if (host.webPreview) previewOf(session).open(address);
  else if (host.openUrl) host.openUrl(address);
  else openInWindow(address);
}
