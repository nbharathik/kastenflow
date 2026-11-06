// The addresses the presenter's window needs to draw what the show draws: it cannot ask the host itself, so the show works them out and
// sends them along with the deck.

import { type Deck, picturePaths } from "@kasten-slides/wasm";

import { posterPaths } from "../export/posters.ts";
import type { ImageUrl } from "../render/index.ts";

/** How often the show tells the presenter's window it is there. */
export const BEAT_MS = 2000;

/** The files that videos name as their `src`, in the order they first appear, at any depth. */
export function videoPaths(deck: Deck): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "video" && typeof record.src === "string" && record.src !== "") found.add(record.src);
      for (const inner of Object.values(record)) walk(inner);
    }
  };
  walk(deck.slides);
  return [...found];
}

/** The addresses of the pictures, posters and videos a deck names, for a window that cannot ask the host itself. */
export function imagesOf(deck: Deck, imageUrl: ImageUrl): Record<string, string> {
  const found: Record<string, string> = {};
  for (const path of new Set([...picturePaths(deck), ...posterPaths(deck), ...videoPaths(deck)])) {
    const url = imageUrl(path);
    if (url) found[path] = url;
  }
  return found;
}
