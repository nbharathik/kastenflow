// The parts of the command palette: all of it, or only the commands, the things to insert, or the slides. A part is chosen with the
// buttons under the box, by the command that opened it (Alt+/ opens on the commands), or by a character typed first: ">" for commands,
// "+" for things to insert, "#" for slides.

import type { PaletteMode } from "../chrome/chrome.ts";
import type { PaletteItem, Section } from "./insert-items.ts";

export const MODES: readonly { mode: PaletteMode; label: string; sections: readonly Section[] | null; prefix: string }[] = [
  { mode: "all", label: "All", sections: null, prefix: "" },
  { mode: "commands", label: "Commands", sections: ["Commands"], prefix: ">" },
  { mode: "insert", label: "Insert", sections: ["Text & content", "Media", "Shapes & lines", "Data", "Pages & links", "Smart parts", "Images"], prefix: "+" },
  { mode: "slides", label: "Slides", sections: ["Slides", "Go to slide"], prefix: "#" },
];

/** The part a typed character asks for, and the words after it. A box with no such character first is as the buttons left it. */
export function modeOfQuery(query: string, chosen: PaletteMode): { mode: PaletteMode; words: string } {
  const text = query.trimStart();
  const asked = MODES.find((part) => part.prefix !== "" && text.startsWith(part.prefix));
  return asked ? { mode: asked.mode, words: text.slice(asked.prefix.length) } : { mode: chosen, words: query };
}

/** The items of one part of the palette. */
export function inMode(items: readonly PaletteItem[], mode: PaletteMode): PaletteItem[] {
  const sections = MODES.find((part) => part.mode === mode)?.sections ?? null;
  return sections === null ? [...items] : items.filter((item) => sections.includes(item.group));
}

/** The items, with the ones chosen lately put first (newest first) and the rest as they were: ties in a search are then won by what is used. */
export function recentFirst(items: readonly PaletteItem[], recent: readonly string[]): PaletteItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const first = recent.flatMap((id) => (byId.has(id) ? [byId.get(id) as PaletteItem] : []));
  const chosen = new Set(first);
  return [...first, ...items.filter((item) => !chosen.has(item))];
}
