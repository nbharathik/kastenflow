// Commands about the editor's own chrome rather than the deck: the menu search, the themes and motion panels, how roomy the bars are.
// They are here so that a menu, a button, the palette and a key all reach them the same way.

import { chromeOf } from "../chrome/chrome.ts";
import type { Command } from "./types.ts";

export const chromeCommands: Command[] = [
  {
    id: "view.menu-search",
    label: "Search the menus",
    icon: "search",
    keys: ["Alt+/"],
    scope: "global",
    run: ({ ui }) => chromeOf(ui).openMenuSearch(),
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
