// "Highlight the selected words" for the palette: the page kept from the web in
// front says how to highlight what is selected in it. It imports almost
// nothing: the palette is on the start-up path and the page editor is not.

import { isShown } from "../../shell/visible-dom";
import { useWorkspace } from "../workspace/store";

/** A page that can be highlighted, open in the window. */
export interface Highlighter {
  /** The page's element. */
  dom: HTMLElement;
  /** Highlights the words selected in the page in the colour last used; false when none are. */
  highlight(): Promise<boolean>;
}

const open = new Set<Highlighter>();

/** Registers a page; returns how to forget it. */
export function registerHighlighter(entry: Highlighter): () => void {
  open.add(entry);
  return () => {
    open.delete(entry);
  };
}

/** The pages on screen: the focused one's first, then the focused pane's. */
function inFront(): Highlighter[] {
  const live = [...open].filter((h) => h.dom.isConnected && isShown(h.dom));
  const rank = (h: Highlighter) => (h.dom.contains(document.activeElement) ? 0 : h.dom.closest(".kasten-pane.is-focused") ? 1 : 2);
  return live.sort((a, b) => rank(a) - rank(b));
}

/** Highlights the words selected in the page kept from the web that is in front. Says why when it cannot. */
export async function highlightSelection(): Promise<boolean> {
  const pages = inFront();
  for (const page of pages) if (await page.highlight()) return true;
  useWorkspace.getState().toast(pages.length === 0 ? "Highlights go on pages kept from the web: open one and select some words" : "Select some words in the page first");
  return false;
}
