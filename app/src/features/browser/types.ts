// What the browser tab and the app say to each other: where a page's native
// view goes, what the page does, and what a capture holds until the person
// confirms it. The app's commands are in src-tauri/src/browser.

import type { CapturedBefore } from "../../lib/vault/collection-types";

/** Where a tab's native view goes, in physical pixels of the window. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a browser tab did: it went to an address, got a title, started or
 * finished loading, asked for a new tab (a link that wants a window), asked to
 * download something (refused), or its view was closed to make room. */
export interface BrowserEvent {
  id: string;
  kind: "url" | "title" | "loading" | "new-tab" | "download" | "closed";
  url?: string | null;
  title?: string | null;
  loading?: boolean | null;
}

export type Nav = { action: "back" } | { action: "forward" } | { action: "reload" } | { action: "url"; url: string };

/** What would be kept, shown before anything is written. */
export interface Previewed {
  /** Hand this back to confirm or discard. */
  token: string;
  kind: "selection" | "page";
  url: string;
  title: string;
  site: string;
  excerpt: string;
  bytes: number;
  /** The notes already kept from this page, the first saved first; none for a page not saved before. */
  existing?: CapturedBefore[];
}

/** Where a confirmed capture goes. */
export type Where = { kind: "inbox" } | { kind: "project"; project: string } | { kind: "page"; path: string; heading?: string | null };

/** What was kept. */
export interface Saved {
  path: string;
  title: string;
  /** Where it went, in words. */
  place: string;
}

/** How the window reaches the browser: the app's commands, or a stand-in. */
export interface BrowserBackend {
  /** Whether web pages can be shown at all (the desktop app only). */
  readonly available: boolean;
  enabled(): Promise<boolean>;
  setEnabled(on: boolean): Promise<boolean>;
  open(id: string, url: string, bounds: Bounds): Promise<string>;
  bounds(id: string, bounds: Bounds): Promise<void>;
  hide(id: string): Promise<void>;
  show(id: string): Promise<void>;
  close(id: string): Promise<void>;
  nav(id: string, nav: Nav): Promise<void>;
  capture(id: string, kind: "selection" | "page"): Promise<Previewed>;
  /** What the page in tab `id` says about itself in its tags (for "Save as paper"): its address, title and the tags as JSON text the page wrote. Absent in a stand-in that has no pages. */
  pageMeta?(id: string): Promise<{ url: string; title: string; meta: string }>;
  /** Keeps the capture held under `token`. A card for a page already saved is refused unless `again` is true, which keeps it as a snapshot of the first. */
  confirm(token: string, where: Where, title?: string | null, again?: boolean): Promise<Saved>;
  discard(token: string): Promise<void>;
  clearData(): Promise<void>;
  /** Listens to every tab's events; resolves to how to stop. */
  onEvent(listener: (event: BrowserEvent) => void): Promise<() => void>;
}
