// What the find bar remembers between pages and sessions: Match case and
// Whole word, in the browser's storage for this window.

import { NO_OPTIONS, type FindOptions } from "./find";

const KEY = "kasten.find";

export function readFindOptions(): FindOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<FindOptions> | null;
    return { matchCase: saved?.matchCase === true, wholeWord: saved?.wholeWord === true };
  } catch {
    return NO_OPTIONS;
  }
}

export function writeFindOptions(options: FindOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // Storage can be off; the options last until the window closes.
  }
}
