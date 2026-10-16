// Commands for presenting beyond the two in the View menu (Present, Present from beginning): the presenter's view, and the whole
// deck as a page. Each goes through the host's "present" action, which is the editor's own unless the host gives another.

import type { Command } from "./types.ts";

export const presentCommands: Command[] = [
  {
    id: "view.presenter",
    label: "Presenter view",
    icon: "users",
    keys: ["Mod+Alt+Enter"],
    scope: "global",
    run: ({ ui }) => ui.actions.present?.("current", { presenter: true }),
  },
  {
    // A run-through with the clock on: the presenter's view opens and times each slide and step. Nothing advances by itself.
    id: "view.rehearse",
    label: "Rehearse",
    icon: "timer",
    scope: "global",
    run: ({ ui }) => ui.actions.present?.("start", { presenter: true, rehearse: true }),
  },
  {
    id: "view.rehearsals",
    label: "Past rehearsals…",
    icon: "clock",
    scope: "global",
    run: ({ ui }) => ui.openDialog("rehearsals"),
  },
  {
    id: "view.present-scroll",
    label: "Scroll view with notes",
    icon: "file-text",
    run: ({ ui }) => ui.actions.present?.("start", { view: "scroll" }),
  },
];
