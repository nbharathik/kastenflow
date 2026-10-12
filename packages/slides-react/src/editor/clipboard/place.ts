// Where a copy, a cut or a paste is meant: the slides of the filmstrip or the grid, the blocks of the slide, or something with its own
// clipboard (the words of a text box being written, a field, the outline, the images drawer, a dialog), which is left to the browser.

import type { CommandContext } from "../commands/types.ts";
import type { EditorUi } from "../ui-state.ts";

/** What copying and pasting is about here. `own`: the thing under the focus does it itself. */
export type Place = "slides" | "elements" | "own";

/** What takes its own copy and paste: a field, the editor of a text box, a dialog, a menu, the images drawer. */
const OWN = "input, textarea, select, [contenteditable]:not([contenteditable='false']), .ks-dialog, .ks-gallery, .ks-popover, [role='menu']";
/** The lists of slides. */
const SLIDES = ".ks-filmstrip, .ks-grid-view";
/** Where words can be picked out and copied as words: a panel. */
const WORDS = ".ks-side-panel";

const hasWordsSelected = (): boolean => {
  const picked = typeof window.getSelection === "function" ? window.getSelection() : null;
  return picked !== null && !picked.isCollapsed && picked.toString().trim() !== "";
};

/** Where an event whose target is `target` is meant, or a key's, a menu's: the place the focus is in. */
export function placeOf(target: EventTarget | null, ui: EditorUi): Place {
  const element = target instanceof Element ? target : null;
  if (element?.closest(OWN)) return "own";
  // A text box open for writing is the text editor's, even with the focus on a button beside it.
  if (ui.state.text !== null) return "own";
  if (ui.state.view === "outline") return "own";
  if (element?.closest(WORDS) && hasWordsSelected()) return "own";
  if (ui.state.view === "grid" || element?.closest(SLIDES)) return "slides";
  return "elements";
}

/** Where a menu's Copy, Cut or Paste is meant: where the focus last was in the editor (the menu itself has the focus now). */
export function placeFor({ ui }: Pick<CommandContext, "ui">): Exclude<Place, "own"> {
  return ui.state.view === "grid" || ui.areas.focused?.closest(SLIDES) ? "slides" : "elements";
}
