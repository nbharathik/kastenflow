import type { Command } from "./types.ts";

/** Header and footer, and the rulers, grid and guides: what sits at the edge of a slide and helps to place things on it. */
export const aidsCommands: Command[] = [
  {
    // The footer words, the date and the slide number in one dialog.
    id: "slide.header-footer",
    label: "Header & footer…",
    icon: "layers",
    run: ({ ui }) => ui.openDialog("header-footer"),
  },
  {
    id: "view.rulers",
    label: "Rulers",
    icon: "ruler",
    checked: (state) => Boolean(state.deck.present.guides?.rulers),
    run: ({ session }) => session.aids.setRulers(!session.deck.present.guides?.rulers),
  },
  {
    id: "view.grid-lines",
    label: "Gridlines",
    icon: "grid-2x2",
    checked: (state) => Boolean(state.deck.present.guides?.showGrid),
    run: ({ session }) => session.aids.setShowGrid(!session.deck.present.guides?.showGrid),
  },
  {
    id: "view.guides",
    label: "Guides and grid…",
    icon: "ruler",
    run: ({ ui }) => ui.openDialog("guides"),
  },
];
