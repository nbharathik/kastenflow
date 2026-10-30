// Finding the block under the pointer inside columns. The block handle and a
// dragged block look for the block across the middle of the text column;
// with columns side by side the pointer's own column is the one to look in.

import type { EditorView } from "@milkdown/kit/prose/view";

/** How far the pointer may be beside a column's text and still mean that column: the gap the handle lives in. */
const REACH = 40;

/**
 * Where to look for the block when the pointer is at (`x`, `y`) over a
 * columns block: a point inside the pointer's column, at that height. Null
 * when the pointer is not over one.
 */
export function columnProbe(view: EditorView, x: number, y: number): { x: number; y: number } | null {
  for (const body of view.dom.querySelectorAll<HTMLElement>(".kasten-columns-body")) {
    const box = body.getBoundingClientRect();
    if (y < box.top || y > box.bottom) continue;
    const columns = Array.from(body.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    // Stacked columns are one under the other: the page's middle will do.
    if (columns.length < 2 || columns[0]!.getBoundingClientRect().top !== columns[1]!.getBoundingClientRect().top) return null;
    let mine = columns[0]!;
    for (const column of columns) if (column.getBoundingClientRect().left - REACH <= x) mine = column;
    const rect = mine.getBoundingClientRect();
    return { x: rect.left + Math.min(16, rect.width / 2), y: Math.min(Math.max(y, rect.top + 1), rect.bottom - 1) };
  }
  return null;
}
