// Every page open in the window (in tabs, split panes and the side stack),
// so app-wide actions (Ctrl+S, moving or trashing a note) can write their
// waiting edits first, and a change on disk reaches each page showing it.

import type { PageSession } from "./page-session";

/** Where the reader was in a page, to come back to after a reload. */
export interface PageView {
  caret: number | null;
  scroll: number;
}

interface OpenPage {
  session: PageSession;
  /** Reloads the page from disk. */
  reload(): void;
  /** Reloads it only if the file changed and no edits are waiting. */
  check(): void;
  view: (() => PageView) | null;
  /** Hands the page's typing not yet passed on (the editor's last moments,
   * a title still being typed) to its session. */
  pass: (() => void) | null;
}

const open = new Set<OpenPage>();

/** Registers an open page; returns how to forget it. */
export function registerPage(session: PageSession, reload: () => void, check: () => void): () => void {
  const entry: OpenPage = { session, reload, check, view: null, pass: null };
  open.add(entry);
  return () => void open.delete(entry);
}

const entryOf = (session: PageSession) => [...open].find((e) => e.session === session);

/** The open page's session showing `path`, if any. */
export function pageFor(path: string): PageSession | undefined {
  return [...open].find((e) => e.session.path === path)?.session;
}

/** Other things open in the window that keep edits waiting (a diagram in its editor), written at the same moments. */
const flushers = new Set<() => Promise<void>>();

/** Registers a flusher run whenever the open pages are written (a tab left, a note moved, the window closing); returns how to forget it. */
export function registerFlusher(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => void flushers.delete(flush);
}

/** Writes every open page's waiting edits now, its latest typing too. */
export async function flushOpenPage(): Promise<void> {
  for (const entry of [...open]) entry.pass?.();
  await Promise.all([...[...open].map((e) => e.session.flush()), ...[...flushers].map((f) => f())]);
}

/** Registers how to hand a page's latest typing to its session. */
export function setPagePass(session: PageSession, pass: (() => void) | null): void {
  const entry = entryOf(session);
  if (entry) entry.pass = pass;
}

/** Hands the latest typing of the page for `session` to it, before the
 * session writes, closes or reloads. */
export function passTyping(session: PageSession | null): void {
  if (session) entryOf(session)?.pass?.();
}

/** Reloads the pages showing `path` (after an op changed that file, such as
 * links renamed), or every open page. */
export function reloadOpenPage(path?: string): void {
  for (const entry of [...open]) if (path === undefined || entry.session.path === path) entry.reload();
}

/** Tells the open pages that files changed on disk. */
export function filesChanged(paths: string[]): void {
  for (const entry of [...open]) if (paths.includes(entry.session.path)) entry.check();
}

/** Asks every open page to look at its file (after a sleep, when changes may have gone unreported). */
export function checkOpenPages(): void {
  for (const entry of [...open]) entry.check();
}

/** Registers how to read a page's caret and scroll position. */
export function setPageView(session: PageSession, read: (() => PageView) | null): void {
  const entry = entryOf(session);
  if (entry) entry.view = read;
}

/** Where the reader is in the page for `session`. */
export function pageView(session: PageSession): PageView | null {
  return entryOf(session)?.view?.() ?? null;
}
