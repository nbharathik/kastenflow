// The page editors open in the window, so the palette can ask the one in front
// for a citation to insert. It imports almost nothing: the palette is on the
// start-up path and the editor is not.

import { useWorkspace } from "../../../workspace/store";

/** A page editor that can take a citation. */
export interface Citer {
  /** The editor's element. */
  dom: HTMLElement;
  /** Opens the citation menu at the caret; false when the page cannot take one (it is read only). */
  insert(): boolean;
}

const open = new Set<Citer>();

/** Registers an editor; returns how to forget it. */
export function registerCiter(entry: Citer): () => void {
  open.add(entry);
  return () => {
    open.delete(entry);
  };
}

/** The editors on screen: the focused one first, then the focused pane's. */
function inFront(): Citer[] {
  const live = [...open].filter((c) => c.dom.isConnected);
  const rank = (c: Citer) => (c.dom.contains(document.activeElement) ? 0 : c.dom.closest(".kasten-pane.is-focused") ? 1 : 2);
  return live.sort((a, b) => rank(a) - rank(b));
}

/** Opens the citation menu in the page in front. Says why when there is no page to put one in. */
export function insertCitation(): boolean {
  for (const page of inFront()) if (page.insert()) return true;
  useWorkspace.getState().toast("Open a page and put the caret where the citation goes");
  return false;
}
