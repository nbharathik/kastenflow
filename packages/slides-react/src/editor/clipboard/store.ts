// What the editors of this window remember about the clipboard. The system clipboard is the way between windows and programs; this is
// the way between decks of one window (two editors side by side), and what is left when a webview keeps nothing but the words. It also
// counts the pastes of each copy so that each one steps further from the one before.

import type { Clip } from "./format.ts";

interface Last {
  clip: Clip;
  words: string;
}

let last: Last | null = null;
/** How many times a copy has been pasted onto each slide, by the copy's stamp and the slide's id. */
const counts = new Map<string, number>();
/** When Paste in place was last asked for by its key. */
let inPlace = 0;

/** Notes a copy: what it was, and the plain text it wrote. */
export function remember(clip: Clip, words: string): void {
  last = { clip, words };
  counts.clear();
}

/**
 * The copy the clipboard still holds, when the plain text on it is what that copy wrote: nothing else has been copied since (a copy of
 * anything, anywhere, replaces the words). `null` when it is not, or when there was no copy.
 */
export function recall(words: string): Clip | null {
  return last !== null && words !== "" && words === last.words ? last.clip : null;
}

/** The copy that was last made, whatever is on the clipboard now: for a paste that cannot read the clipboard. */
export function latest(): Clip | null {
  return last?.clip ?? null;
}

/** Forgets every copy; for tests. */
export function forget(): void {
  last = null;
  counts.clear();
  inPlace = 0;
}

// ---- stepping

/** Counts a paste of `stamp` onto `slide`; the number of pastes made there before this one. */
export function countPaste(stamp: string, slide: string): number {
  const key = `${stamp}/${slide}`;
  const before = counts.get(key) ?? 0;
  counts.set(key, before + 1);
  return before;
}

// ---- the paste in place key

/** The key for Paste in place went down: the next paste, which the browser makes of it, keeps the place. */
export function askInPlace(at = Date.now()): void {
  inPlace = at;
}

/** Whether the paste being made now was asked for as Paste in place; asking is used up by it. */
export function takeInPlace(now = Date.now()): boolean {
  const asked = inPlace !== 0 && now - inPlace < 1500;
  inPlace = 0;
  return asked;
}
