// The window used to remember which chat belonged to which deck in browser
// storage ("kasten.chat.decks"). The ties live on the backend now: that old
// map is handed over once, and the backend never overwrites a tie it has.

import type { ChatClient } from "../client";

const KEY = "kasten.chat.decks";
const DONE = "kasten.chat.decks.imported";

/** The old deck-to-chat map, as far as it holds text for text. */
function oldMap(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
  } catch {
    return {};
  }
}

const done = (): boolean => {
  try {
    return localStorage.getItem(DONE) === "1";
  } catch {
    return false;
  }
};

/** The try under way, so callers that ask together send the map once. */
let going: Promise<boolean> | null = null;

/** Hands the old map to the backend, once. Whether anything was sent; a failed try is made again next run. */
export function migrateDeckBindings(client: ChatClient): Promise<boolean> {
  if (done()) return Promise.resolve(false);
  if (going) return going;
  const run = (async () => {
    const map = oldMap();
    try {
      if (Object.keys(map).length > 0) await client.importBindings(map, "deck");
      localStorage.setItem(DONE, "1");
      return Object.keys(map).length > 0;
    } catch {
      // The map is still there; the next run tries again.
      return false;
    }
  })();
  going = run;
  void run.finally(() => {
    if (going === run) going = null;
  });
  return run;
}
