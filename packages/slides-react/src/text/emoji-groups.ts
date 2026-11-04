// The emoji of `emoji.ts` laid out for a picker: by category, one entry for each picture however many names it has, and a search by name.

import { EMOJI } from "./emoji.ts";

export interface EmojiItem {
  glyph: string;
  /** Every `:name:` that stands for it, the first being the one it is called by. */
  names: string[];
  /** The name as words ("sweat smile"). */
  label: string;
}

export interface EmojiCategory {
  title: string;
  items: EmojiItem[];
}

/** The shortcodes in each category, in the order the picker shows them. Every name of the list is in exactly one. */
const CATEGORIES: readonly { title: string; names: readonly string[] }[] = [
  { title: "Faces", names: ["smile", "grin", "joy", "rofl", "laughing", "sweat_smile", "wink", "blush", "slightly_smiling_face", "sunglasses", "thinking", "confused", "cry", "sob"] },
  { title: "Hands & people", names: ["wave", "clap", "pray", "muscle", "ok_hand", "point_right", "thumbsup", "+1", "thumbsdown", "-1", "eyes"] },
  { title: "Symbols", names: ["heart", "star", "sparkles", "fire", "zap", "sunny", "100", "white_check_mark", "check", "x", "warning", "arrow_right", "hourglass"] },
  { title: "Objects & food", names: ["tada", "rocket", "bulb", "trophy", "gift", "memo", "books", "mag", "lock", "key", "bug", "coffee", "pizza"] },
];

const words = (name: string): string => name.replace(/_/g, " ");

/** Every category with its pictures; names that share a picture (`check` and `white_check_mark`) are one entry. */
export const EMOJI_CATEGORIES: readonly EmojiCategory[] = CATEGORIES.map(({ title, names }) => {
  const items: EmojiItem[] = [];
  for (const name of names) {
    const glyph = EMOJI[name];
    if (glyph === undefined) continue;
    const held = items.find((item) => item.glyph === glyph);
    if (held) held.names.push(name);
    else items.push({ glyph, names: [name], label: words(name) });
  }
  return { title, items };
});

/**
 * The categories with only the pictures a search finds: every word typed must be in one of a picture's names or in its category's
 * title. An empty search finds all; a category with none left is dropped.
 */
export function findEmoji(search: string, categories: readonly EmojiCategory[] = EMOJI_CATEGORIES): EmojiCategory[] {
  const typed = search.toLowerCase().replace(/:/g, " ").split(/\s+/).filter(Boolean);
  if (typed.length === 0) return [...categories];
  return categories
    .map((category) => ({
      title: category.title,
      items: category.items.filter((item) => typed.every((word) => `${item.names.map(words).join(" ")} ${category.title}`.toLowerCase().includes(word))),
    }))
    .filter((category) => category.items.length > 0);
}
