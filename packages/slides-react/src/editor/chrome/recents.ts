// Lists of what was used lately (fonts, colours): the newest first, no repeats, a fixed length.

import { isStringList, readStored, writeStored } from "./storage.ts";

/** `list` with `item` put first, any earlier copy taken out (case does not matter), and no more than `max` kept. */
export function pushRecent(list: readonly string[], item: string, max: number): string[] {
  const key = item.toLowerCase();
  return [item, ...list.filter((other) => other.toLowerCase() !== key)].slice(0, max);
}

export const RECENT_FONTS_MAX = 5;
export const RECENT_COLOURS_MAX = 10;

export function recentFonts(): string[] {
  return readStored("recent-fonts", [], isStringList);
}

export function noteFont(family: string): void {
  writeStored("recent-fonts", pushRecent(recentFonts(), family, RECENT_FONTS_MAX));
}

export function recentColours(): string[] {
  return readStored("recent-colours", [], isStringList);
}

/** Remembers a colour that was picked as a value of its own (`#rrggbb`); theme tokens follow the theme and are not remembered. */
export function noteColour(hex: string): void {
  if (/^#[0-9a-f]{6}$/i.test(hex)) writeStored("recent-colours", pushRecent(recentColours(), hex.toLowerCase(), RECENT_COLOURS_MAX));
}
