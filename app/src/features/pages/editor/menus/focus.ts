// Writing wherever the page is clicked: below the last block, or beside any
// block, the caret goes where the click points. Below the last block it goes
// to an empty paragraph at the end, added when the page does not end in one.
// An empty paragraph is left out when the note is saved, so a click alone never
// changes the file.

import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { sectionsKey } from "../sections/key";

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Puts the caret in an empty paragraph at the end of the page, adding one
 * when the page ends in anything else. When the last section is folded there
 * is nothing to write in, so the caret goes to the last text shown. */
export function focusEnd(view: EditorView): void {
  const { state } = view;
  const { doc } = state;
  const paragraph = state.schema.nodes.paragraph!;
  const tr = state.tr;
  const folded = sectionsKey.getState(state)?.hidden.find((range) => range.to >= doc.content.size);
  if (folded) {
    const shown = Selection.findFrom(doc.resolve(folded.from), -1, true);
    if (shown) tr.setSelection(shown);
  } else {
    const last = doc.lastChild;
    if (!(last?.type === paragraph && last.content.size === 0)) tr.insert(doc.content.size, paragraph.create());
    tr.setSelection(Selection.atEnd(tr.doc));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Where the last block shown ends, on screen; the editor's own bottom when it is not drawn. */
function lastBottom(view: EditorView): number {
  const { doc } = view.state;
  const last = doc.lastChild;
  const dom = last ? view.nodeDOM(doc.content.size - last.nodeSize) : null;
  const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
  return rect && rect.height > 0 ? rect.bottom : view.dom.getBoundingClientRect().bottom;
}

/** Puts the caret where a click at (`x`, `y`) points: the nearest text, with
 * `x` taken into the page's column when the click was in the margin, and the
 * end of the page when it was below the last block. */
export function focusAt(view: EditorView, x: number, y: number): void {
  const box = view.dom.getBoundingClientRect();
  if (y >= lastBottom(view)) return focusEnd(view);
  const hit = view.posAtCoords({ left: clamp(x, box.left + 1, box.right - 1), top: clamp(y, box.top + 1, box.bottom - 1) });
  if (!hit) return focusEnd(view);
  const { state } = view;
  view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(hit.pos))).scrollIntoView());
  view.focus();
}
