// Putting a section somewhere else: what the outline strip's drag and its keys
// do. The `---` lines stay where they are and the content between them moves,
// so the page keeps the same dividers (and the bytes they were written in)
// and only the text of the sections it moved is in another place. It is one
// transaction, so one undo puts everything back.

import { Fragment } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { sectionsKey, type SectionsMeta } from "./key";
import { sectionsOf, START } from "./model";

/** The sections' blocks, in the order `order` says (the sections' numbers),
 * with the page's own dividers between them as they stand now. */
function shuffled(view: EditorView, first: number, order: readonly number[]): { content: Fragment; starts: Map<number, number> } {
  const { doc } = view.state;
  const sections = sectionsOf(doc);
  let content = Fragment.empty;
  const starts = new Map<number, number>();
  order.forEach((index, place) => {
    // The divider that was between these two places is still between them.
    if (place > 0) content = content.append(Fragment.from(doc.nodeAt(sections[first + place]!.divider!)));
    starts.set(index, content.size);
    content = content.append(doc.slice(sections[index]!.from, sections[index]!.to).content);
  });
  return { content, starts };
}

/** Moves section `from` so that it is section `to`, in one step of the page's
 * history; false when there is nothing to move. Sections are numbered as
 * `sectionsOf` does: 0 is the part before the first divider. */
export function moveSection(view: EditorView, from: number, to: number): boolean {
  const sections = sectionsOf(view.state.doc);
  if (from === to || from < 0 || to < 0 || from >= sections.length || to >= sections.length) return false;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const order = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  order.splice(from - lo, 1);
  order.splice(to - lo, 0, from);
  const { content, starts } = shuffled(view, lo, order);
  const start = sections[lo]!.from;
  const tr = view.state.tr.replaceWith(start, sections[hi]!.to, content);
  // The first section has no divider to keep its fold with: it is unfolded, as what it holds changed.
  if (lo === 0 && (sectionsKey.getState(view.state)?.folded.has(START) ?? false)) tr.setMeta(sectionsKey, { set: [START], folded: false } satisfies SectionsMeta);
  // The caret goes to where the section moved to.
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + starts.get(from)!), 1));
  view.dispatch(tr);
  return true;
}
