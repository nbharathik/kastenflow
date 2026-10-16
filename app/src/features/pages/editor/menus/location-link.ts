// "Copy link to this location": the editor does not know which page it holds,
// so the page that made it hands over a function that does, and the block menu
// offers the entry on a heading when there is one.

import type { EditorView } from "@milkdown/kit/prose/view";

export interface HeadingSpot {
  text: string;
  /** Which of the headings with that text, from 1. */
  nth: number;
}

const copiers = new WeakMap<EditorView, (spot: HeadingSpot) => void>();

export function setLocationCopier(view: EditorView, copy: ((spot: HeadingSpot) => void) | undefined): void {
  if (copy) copiers.set(view, copy);
  else copiers.delete(view);
}

export const locationCopierFor = (view: EditorView): ((spot: HeadingSpot) => void) | undefined => copiers.get(view);
