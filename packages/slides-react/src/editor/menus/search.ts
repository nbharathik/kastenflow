// Every row of every menu, found by the words of its name or the menus it is in, as Google Slides does, so a command can be run without
// knowing where it lives. The command palette lists these rows (`flattenMenus`) and ranks them itself.

import type { IconName } from "../ui/Icon.tsx";
import type { MenuItem } from "../ui/Menu.tsx";

/** A menu in the form the search needs: the bar's own menus have this shape. */
export interface SearchableMenu {
  label: string;
  items(): MenuItem[];
}

/** One row that can be run, and where it is found. */
export interface MenuHit {
  /** The row's id: the command's own for a row that runs a command. */
  id?: string;
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
          id: item.id,
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

/** Where a row is found, as a line: "Format › Text". */
export const placeOf = (hit: MenuHit): string => hit.path.join(" › ");
