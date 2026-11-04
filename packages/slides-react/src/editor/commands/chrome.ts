// Commands about the editor's own chrome rather than the deck: the command palette, the themes and motion panels, how roomy the bars are.
// They are here so that a menu, a button, the palette and a key all reach them the same way.

import { type PaletteMode, chromeOf } from "../chrome/chrome.ts";
import type { Command, CommandContext } from "./types.ts";

/** Opens the command palette on all of it, or on the commands, the things to insert, or the slides. */
export function openPalette({ ui }: CommandContext, mode: PaletteMode = "all"): void {
  chromeOf(ui).askPalette(mode);
  ui.openDialog("insert");
}

export const chromeCommands: Command[] = [
  {
    id: "view.palette",
    label: "Command palette…",
    icon: "search",
    keys: ["Mod+Shift+P"],
    scope: "global",
    run: (context) => openPalette(context, "all"),
  },
  {
    // Ctrl+K is "Insert link" while a text box is open or something is selected, as it has always been. This is the same palette on the same
    // key for the rest: it works with the slide or a bar having the keys (never in a text box, which has the link), and "Insert link" comes
    // first in the list, so it wins whenever there is something to link. Ctrl+Shift+P opens the palette everywhere.
    id: "view.palette-k",
    label: "Command palette, when nothing is selected",
    icon: "search",
    keys: ["Mod+K"],
    scope: "canvas",
    run: (context) => openPalette(context, "all"),
  },
  {
    id: "view.menu-search",
    label: "Search the menus",
    icon: "search",
    keys: ["Alt+/"],
    scope: "global",
    run: (context) => openPalette(context, "commands"),
  },
  {
    id: "view.themes-panel",
    label: "Themes and layouts",
    icon: "palette",
    checked: (_, ui) => ui.panel === "themes",
    run: ({ ui }) => ui.togglePanel("themes"),
  },
  {
    id: "view.motion-panel",
    label: "Transitions and motion",
    icon: "film",
    checked: (_, ui) => ui.panel === "transitions",
    run: ({ ui }) => ui.togglePanel("transitions"),
  },
  {
    id: "view.density",
    label: "Compact toolbars",
    icon: "sliders-horizontal",
    run: ({ ui }) => chromeOf(ui).toggleDensity(),
  },
];
