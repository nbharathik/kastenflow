// The menu search ("Menus", Alt+/): every row of every menu, found by the words of its name or the menus it is in, as Google Slides
// does, so a command can be run without knowing where it lives.

import type { IconName } from "../ui/Icon.tsx";
import type { MenuItem } from "../ui/Menu.tsx";

/** A menu in the form the search needs: the bar's own menus have this shape. */
export interface SearchableMenu {
  label: string;
  items(): MenuItem[];
}

/** One row that can be run, and where it is found. */
export interface MenuHit {
  /** The menus it is in, outermost first: `["Format", "Text"]` for Bold. */
  path: string[];
  label: string;
  icon?: IconName;
  keys?: string;
  checked?: boolean;
  disabled: boolean;
  run(): void;
}

/** Every row of the menus that does something, with the names of the menus above it. */
export function flattenMenus(menus: readonly SearchableMenu[]): MenuHit[] {
  const hits: MenuHit[] = [];
  const walk = (items: readonly MenuItem[], path: string[], disabled: boolean) => {
    for (const item of items) {
      if (item.kind === "separator" || item.kind === "heading") continue;
      if (item.items) walk(item.items, [...path, item.label], disabled || item.disabled === true);
      else if (item.run) {
        hits.push({
          path,
          label: item.label,
          ...(item.icon ? { icon: item.icon } : {}),
          ...(item.keys ? { keys: item.keys } : {}),
          ...(item.checked === undefined ? {} : { checked: item.checked }),
          disabled: disabled || item.disabled === true,
          run: item.run,
        });
      }
    }
  };
  for (const menu of menus) walk(menu.items(), [menu.label], false);
  return hits;
}

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** How well a row answers the words typed: lower is better, null is no answer. */
function score(hit: MenuHit, query: string, typed: string[]): number | null {
  const label = hit.label.toLowerCase();
  const labelWords = words(hit.label);
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (labelWords.some((word) => word.startsWith(query))) return 2;
  if (label.includes(query)) return 3;
  const place = words(hit.path.join(" "));
  const every = typed.every((word) => labelWords.some((w) => w.startsWith(word)) || place.some((w) => w.startsWith(word)));
  if (every) return typed.every((word) => labelWords.some((w) => w.startsWith(word))) ? 4 : 5;
  return null;
}

/** The rows that answer `query`, the best first; rows that cannot be run now come after those that can at the same level. */
export function searchMenus(hits: readonly MenuHit[], query: string, limit = 12): MenuHit[] {
  const text = query.trim().toLowerCase();
  if (text === "") return [];
  const typed = words(text);
  return hits
    .map((hit, index) => ({ hit, index, rank: score(hit, text, typed) }))
    .filter((found): found is { hit: MenuHit; index: number; rank: number } => found.rank !== null)
    .sort((a, b) => a.rank - b.rank || Number(a.hit.disabled) - Number(b.hit.disabled) || a.index - b.index)
    .slice(0, limit)
    .map((found) => found.hit);
}

/** Where a row is found, as a line: "Format › Text". */
export const placeOf = (hit: MenuHit): string => hit.path.join(" › ");
