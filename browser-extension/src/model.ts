// What the extension and Kasten say to each other, and what the extension keeps.
// The routes are Kasten's: POST /v1/pair, GET /v1/targets, POST /v1/capture on
// 127.0.0.1. They add and list; nothing here reads a note.

/** The port Kasten listens on unless its Settings say otherwise. */
export const DEFAULT_PORT = 7434;

/** Where a capture goes: a card in the Captures table (the Inbox), a card in a
 * project, or a quote added to the end of a page (or of its section under a heading). */
export type Target = { kind: "inbox" } | { kind: "project"; project: string } | { kind: "page"; path: string; heading?: string };

/** What is sent for one capture. */
export interface CaptureRequest {
  url: string;
  title?: string;
  /** The page or the selection as HTML; Kasten reads the article out of it. */
  html?: string;
  /** Or as plain text. */
  text?: string;
  target?: Target;
  tags?: string[];
}

/** The places a capture can go, by name and path only. */
export interface Targets {
  vault: string;
  inbox: { name: string };
  projects: { id: string; name: string }[];
  pages: { path: string; title: string }[];
}

/** What Kasten kept. */
export interface Saved {
  ok: true;
  path: string;
  title: string;
  /** Where it went, in words. */
  place: string;
}

/** What Kasten gives back for a right pairing code. */
export interface Paired {
  token: string;
  id: string;
  vault: string;
}

/** What is kept in the browser's storage for this extension. */
export interface Settings {
  /** The bearer token Kasten gave when this extension was paired; none until then. */
  token: string | null;
  port: number;
  /** The vault's name, for "Connected to ...". */
  vault: string | null;
  /** Where the last capture went: where a right-click send goes too. */
  lastTarget: Target;
}

export const NO_SETTINGS: Settings = { token: null, port: DEFAULT_PORT, vault: null, lastTarget: { kind: "inbox" } };
