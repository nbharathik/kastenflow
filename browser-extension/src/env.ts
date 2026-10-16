// What the extension needs from the browser, as small interfaces. The entry
// files (`background-main.ts`, `popup-main.ts`) fit Chrome's and Edge's own
// objects to these; everything else is written against them, so it runs with a
// stand-in for the browser in tests.

import type { PaperTags } from "./model.js";

/** `chrome.storage.local`: only this extension's own keys. */
export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** The part of a tab the extension reads. */
export interface Tab {
  id?: number;
  /** The address the browser shows (not the one the page reports). */
  url?: string;
  title?: string;
}

/** `fetch`, as the extension calls it. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What the page says of itself, read by a script run in the tab when the
 * person asks. `html` is the page with scripts, styles and the like taken out. */
export interface PageRead {
  title: string;
  selectionHtml: string;
  selectionText: string;
  html: string;
  text: string;
  /** The tags the page describes itself by, for "Save as paper". */
  paper?: PaperTags;
}

/** Runs `readPage` in a tab (the person's own gesture lets it); null when the page cannot be read (the browser's own pages, the web store). */
export type ReadTab = (tabId: number) => Promise<PageRead | null>;

/** What a right-click menu click carries. */
export interface MenuClick {
  menuItemId: string;
  pageUrl?: string;
  linkUrl?: string;
  srcUrl?: string;
  selectionText?: string;
}
