// The commands and the slides of the command palette. The commands are the rows of the menus as they are when the palette opens (so
// the name is the menu's own, "Undo typing", and the keys and the menu they are in are shown), then any command that no menu has.

import { type CommandContext, COMMANDS, isEnabled, keysOf, runCommand } from "../commands/index.ts";
import { INSERT_ENTRIES } from "../insert/model.ts";
import { barMenus } from "../menus/bar-menus.ts";
import { flattenMenus, placeOf } from "../menus/search.ts";
import type { PaletteItem } from "./insert-items.ts";
import { slideTitle } from "./slide-title.ts";

/** What the commands of each family are called when no menu holds them. */
const AREA_NAMES: Record<string, string> = {
  edit: "Edit",
  text: "Text",
  slide: "Slide",
  steps: "Steps",
  arrange: "Arrange",
  view: "View",
  file: "File",
  help: "Help",
  present: "Present",
  lint: "Check",
  import: "Import",
};

const areaOf = (id: string): string => {
  const family = id.split(".")[0] ?? id;
  return AREA_NAMES[family] ?? family.charAt(0).toUpperCase() + family.slice(1);
};

/** The commands that open the palette itself: listed nowhere in it. */
const PALETTE_OPENERS: ReadonlySet<string> = new Set(["view.palette", "view.palette-k", "view.menu-search"]);

/**
 * Every command that can be done now: the rows of the menus, each with the menu it is in and its keys, then the commands no menu has.
 * What inserts is left out (the palette lists it in its own sections), and so is a row that cannot be done now.
 */
export function commandItems(context: CommandContext): PaletteItem[] {
  const listed = new Set(INSERT_ENTRIES.map((entry) => entry.command));
  const skip = (id: string | undefined): boolean => id !== undefined && (PALETTE_OPENERS.has(id) || id.startsWith("insert.") || listed.has(id));
  const hits = flattenMenus(barMenus(context)).filter((hit) => !hit.disabled && hit.path[0] !== "Insert" && !skip(hit.id));
  const items = new Map<string, PaletteItem>();
  for (const hit of hits) {
    const id = hit.id !== undefined && COMMANDS.has(hit.id) ? hit.id : `menu.${placeOf(hit)}.${hit.id ?? hit.label}`;
    if (items.has(id)) continue;
    // A menu says "Fit" under Zoom; away from its menu the command's own "Zoom to fit" says what it is. A label that adds to the command's
    // ("Undo typing") is kept.
    const own = hit.id === undefined ? undefined : COMMANDS.get(hit.id)?.label;
    const label = own !== undefined && own.length > hit.label.length && own.toLowerCase().includes(hit.label.toLowerCase()) ? own : hit.label;
    items.set(id, {
      id,
      group: "Commands",
      label,
      ...(hit.icon ? { icon: hit.icon } : {}),
      description: placeOf(hit),
      keywords: hit.path,
      ...(hit.keys ? { keys: hit.keys } : {}),
      run: () => hit.run(),
    });
  }
  for (const command of COMMANDS.values()) {
    if (items.has(command.id) || skip(command.id) || !isEnabled(command, context)) continue;
    const keys = keysOf(command.id);
    items.set(command.id, {
      id: command.id,
      group: "Commands",
      label: command.label,
      ...(command.icon ? { icon: command.icon } : {}),
      description: areaOf(command.id),
      ...(keys ? { keys } : {}),
      run: (ctx) => runCommand(command.id, ctx),
    });
  }
  return [...items.values()];
}

/** Each slide of the deck, to go to by its number or its title. */
export function goToSlides({ session }: CommandContext): PaletteItem[] {
  return session.deck.slides.map((slide, i) => ({
    id: `palette.goto.${slide.id}`,
    group: "Go to slide",
    label: `Slide ${i + 1}: ${slideTitle(slide)}`,
    icon: "rectangle-horizontal",
    keywords: ["go to slide", String(i + 1)],
    run: () => void session.goTo(slide.id),
  }));
}
