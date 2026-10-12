// What keeps a folded section honest: the caret never rests in blocks that
// are not shown, and an edit that reaches a folded section unfolds it first.

import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { NodeSelection, Selection } from "@milkdown/kit/prose/state";
import { AttrStep, DocAttrStep, Mapping, ReplaceAroundStep, type Step } from "@milkdown/kit/prose/transform";

import { LOAD_META, type HiddenRange } from "./key";

/** A step that changes a node's markup (a heading's id) or wraps what stays
 * as it was: nothing a reader of the folded blocks would see edited. */
const keepsContent = (step: Step) => step instanceof ReplaceAroundStep || step instanceof AttrStep || step instanceof DocAttrStep;

/** The folded sections the changes of `trs` reach, touching their edges too. */
export function touched(trs: readonly Transaction[], hidden: readonly HiddenRange[]): number[] {
  const maps = trs.flatMap((tr) => tr.mapping.maps);
  const steps = trs.flatMap((tr) => tr.steps);
  const found = new Set<number>();
  maps.forEach((map, i) => {
    if (keepsContent(steps[i]!)) return;
    const later = new Mapping(maps.slice(i + 1));
    map.forEach((_from, _to, start, end) => {
      const from = later.map(start, -1);
      const to = later.map(end, 1);
      for (const range of hidden) if (from <= range.to && to >= range.from) found.add(range.key);
    });
  });
  return [...found];
}

/** Whether `trs` opened a page, which restores its folds rather than touching them. */
export const opened = (trs: readonly Transaction[]) => trs.some((tr) => tr.getMeta(LOAD_META) === true);

const hiddenAt = (hidden: readonly HiddenRange[], from: number, to: number) => hidden.find((range) => from >= range.from && to <= range.to);

/** Where a caret in a folded section goes: past it in the direction it was
 * moving, else to the other side of it. Null when nothing is shown. */
function awayFrom(doc: EditorState["doc"], hidden: readonly HiddenRange[], range: HiddenRange, forward: boolean): Selection | null {
  const find = (dir: 1 | -1): Selection | null => {
    let edge = dir === 1 ? range.to : range.from;
    for (let guard = 0; guard <= hidden.length; guard++) {
      const found = Selection.findFrom(doc.resolve(edge), dir, true);
      if (!found) return null;
      const inside = hiddenAt(hidden, found.from, found.to);
      if (!inside) return found;
      edge = dir === 1 ? inside.to : inside.from;
    }
    return null;
  };
  return forward ? (find(1) ?? find(-1)) : (find(-1) ?? find(1));
}

/** The selection to put in place of one in a folded section, or null when it is where it can be. */
export function visibleSelection(oldState: EditorState, state: EditorState, hidden: readonly HiddenRange[]): Selection | null {
  const { selection } = state;
  const range = hiddenAt(hidden, selection.from, selection.to);
  if (!range) return null;
  // Moving up or left goes back; with nowhere travelled (a fold under the caret), back as well.
  const forward = oldState.doc === state.doc && selection.head > oldState.selection.head;
  const away = awayFrom(state.doc, hidden, range, forward);
  if (!away || (selection instanceof NodeSelection && away.eq(selection))) return null;
  return away;
}
