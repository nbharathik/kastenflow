// The look of an empty paragraph. A paragraph with no words has nothing to hold
// a size, a colour or a font, yet its list marker, the height of its line and
// the words typed into it all depend on them. So an empty paragraph keeps its
// look as a mark of its own (the paragraph's `mark` setting; in the stored text
// it is the one empty run such a paragraph holds), as the paragraph mark of a
// word processor does:
//
//   - a paragraph that is emptied (its words deleted, the `- ` of a list
//     typed over, Enter pressed at the end of a line) keeps the look its
//     words had, so the next words look like the last;
//   - the marks of an empty paragraph are set aside for the words typed into
//     it, whether the caret came there or the paragraph was formatted;
//   - a paragraph that has words is drawn and stored by them: whatever mark it
//     still carries is ignored. It is left alone while words are typed, because
//     a paragraph whose settings change is drawn again, which would end an input
//     method's composition.

import type { Node as PMNode } from "prosemirror-model";
import { type EditorState, Plugin, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { lookOfMarks } from "./convert.ts";
import { markJson } from "./paragraph-attrs.ts";
import { type TextSchema, attrsOf } from "./schema.ts";
import { markOfParagraphAt } from "./selection-info.ts";

/** What history gives the transactions of an undo or a redo as their meta: they put back what was, exactly. */
const HISTORY_META = "history$";

/** Where a position of the document `trs` made was in the document before them. */
function wasAt(trs: readonly Transaction[], pos: number): number {
  let at = pos;
  for (let i = trs.length - 1; i >= 0; i--) at = trs[i]?.mapping.invert().map(at, -1) ?? at;
  return at;
}

/**
 * The look of the words an empty paragraph came from: the marks they had at the start of the paragraph, as the text
 * of a mark (null when the words had no look). Undefined when the paragraph was not made empty by these transactions.
 */
function lookBefore(trs: readonly Transaction[], before: PMNode, pos: number): string | null | undefined {
  const was = wasAt(trs, pos + 1);
  if (was < 0 || was > before.content.size) return undefined;
  const $was = before.resolve(was);
  if ($was.depth < 1 || $was.parent.content.size === 0) return undefined;
  return markJson(lookOfMarks($was.marks()));
}

/** Sets the marks of the empty paragraph the caret is in aside for the next words, when nothing else has. */
function setAside(state: EditorState, tr: Transaction): void {
  const { selection } = state;
  if (!selection.empty || state.storedMarks !== null || tr.storedMarksSet) return;
  const marks = markOfParagraphAt(tr.doc.resolve(selection.from), state.schema as TextSchema);
  if (marks.length > 0) tr.setStoredMarks(marks);
}

/** The plugin that keeps the marks of empty paragraphs. */
export function paragraphMarks(): Plugin {
  return new Plugin({
    appendTransaction(trs, before, state) {
      const tr = state.tr;
      // An undo or a redo puts every setting back as it was.
      if (trs.some((t) => t.docChanged) && !trs.some((t) => t.getMeta(HISTORY_META) !== undefined)) {
        state.doc.forEach((node, pos) => {
          if (node.content.size > 0) return;
          const look = lookBefore(trs, before.doc, pos);
          if (look !== undefined && look !== attrsOf(node).mark) tr.setNodeMarkup(pos, undefined, { ...node.attrs, mark: look });
        });
      }
      // A step of ours puts the marks set aside for the next words away; they are put back.
      if (tr.docChanged && state.storedMarks !== null) tr.setStoredMarks(state.storedMarks);
      else if (trs.some((t) => t.docChanged || t.selectionSet)) setAside(state, tr);
      return tr.docChanged || tr.storedMarksSet ? tr : null;
    },
    props: {
      // Words typed before anything set the paragraph's marks aside (a box opened with the caret in an empty paragraph).
      handleTextInput(view: EditorView) {
        const { state } = view;
        if (!state.selection.empty || state.storedMarks !== null) return false;
        const marks = markOfParagraphAt(state.selection.$from, state.schema as TextSchema);
        if (marks.length > 0) view.dispatch(state.tr.setStoredMarks(marks));
        return false;
      },
    },
  });
}
