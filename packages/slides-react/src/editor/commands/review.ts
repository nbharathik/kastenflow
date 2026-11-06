import type { Command } from "./types.ts";

/** Comments, the accessibility check and the deck's saved versions. */
export const reviewCommands: Command[] = [
  {
    id: "view.comments-panel",
    label: "Comments",
    icon: "message-square",
    checked: (_, ui) => ui.panel === "comments",
    run: ({ ui }) => ui.togglePanel("comments"),
  },
  {
    id: "view.access-panel",
    label: "Accessibility",
    icon: "eye",
    checked: (_, ui) => ui.panel === "access",
    run: ({ ui }) => ui.togglePanel("access"),
  },
  {
    // The versions of the deck's file that the host kept; a restore is put in as one step of undo and saved as a new version.
    id: "deck.history",
    label: "History…",
    icon: "clock",
    enabled: (_, __, host) => host.history !== undefined,
    run: ({ ui }) => ui.openDialog("deck-history"),
  },
];
