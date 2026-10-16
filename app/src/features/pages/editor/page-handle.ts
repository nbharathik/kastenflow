// What the page around the editor can ask of it: where to put the caret, which
// section to show, how to find a word. The editor gives it to the page once
// it is ready.

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";

import { locate, sectionAtOffset, wordsOf, type Range, type Words } from "../../annotations/anchor";
import { editorText, offsetsOf, positionsOf, type EditorText } from "../../annotations/doc-text";
import { setPainted, type Painted } from "../../annotations/paint";
import { findMatches } from "./find/find";
import { focusAt, focusEnd } from "./menus/focus";
import { foldAll, jumpToSection, listSections, revealPos, type SectionInfo } from "./sections/api";
import { moveSection } from "./sections/reorder";

export interface PageEditorHandle {
  /** Puts the caret at the start of the page, as Enter in the title does. */
  focusStart(): void;
  /** Puts the caret in an empty paragraph at the end, as a click below the
   * last block does: one is added when the page ends in something else, and
   * left out of the file until something is typed in it. */
  focusEnd(): void;
  /** Puts the caret where a click at these screen coordinates points: the
   * margins count as the page's column, and below the last block is the end. */
  focusAt(x: number, y: number): void;
  /** Where the caret is, when the editor has focus. */
  caret(): number | null;
  /** Puts the caret back near `pos` after a reload, without scrolling. */
  placeCaret(pos: number): void;
  /** Scrolls to the heading with this text (the `nth` such heading, from 1;
   * the first by default) and puts the caret in it, unfolding the section it
   * is in; false when the page has none. */
  showHeading(text: string, nth?: number): boolean;
  /** Opens the find bar on the first of `queries` the page holds, marking
   * every place it occurs. */
  find(queries: readonly string[]): void;
  /** The page's sections, cut at its dividers: each with its title, where it
   * is, and whether it is folded. A page with no divider is one section. */
  sections(): SectionInfo[];
  /** Folds or unfolds every section; returns how many there are to fold, 0
   * when the page has no divider. */
  foldAll(folded: boolean): number;
  /** Scrolls to section `index` (from 0) and puts the caret at its start. */
  showSection(index: number): boolean;
  /** Moves section `from` so that it is section `to`, as one step of the page's history. */
  moveSection(from: number, to: number): boolean;
  /** Hands the latest typing to `onChange` now. Changes reach it after a
   * 200 ms pause otherwise, and the pause is dropped with the editor. */
  flush(): void;
  /** The page's words as plain text, cut into its sections: what comments
   * and highlights are placed in. */
  annotationText(): EditorText;
  /** The words selected, at most `most` characters of them, with what stands
   * around them and the text they are in; null when nothing is selected. */
  selectedWords(most: number): { words: Words; text: EditorText } | null;
  /** The section (from 0) that the selection's head is in, wherever focus is
   * now: the place a comment is attached to when no words are selected. */
  caretSection(): number;
  /** Selects the words `quote`, found at `range` of the page's text or, when
   * the page has changed, where they are the only match; scrolls to them. False
   * when they are not found. */
  showWords(range: Range, quote: string): boolean;
  /** Paints highlights over the page's words, all of them at once; none clears. */
  paint(list: readonly Painted[]): void;
}

/** Where the `nth` heading (from 1) reading `text` starts, ignoring case, if there is one. */
export function headingAt(doc: ProseNode, text: string, nth = 1): number | null {
  const wanted = text.trim().toLowerCase();
  let seen = 0;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "heading" && node.textContent.trim().toLowerCase() === wanted && ++seen === nth) found = pos;
    return node.isBlock && !node.isTextblock;
  });
  return found;
}

/** Which heading of its text (from 1) the heading at `pos` is, counting from the top of the page. */
export function headingNumber(doc: ProseNode, pos: number): number {
  const node = doc.nodeAt(pos);
  const wanted = node?.textContent.trim().toLowerCase() ?? "";
  let seen = 0;
  doc.descendants((child, at) => {
    if (at > pos) return false;
    if (child.type.name === "heading" && child.textContent.trim().toLowerCase() === wanted) seen += 1;
    return child.isBlock && !child.isTextblock;
  });
  return Math.max(1, seen);
}

export function handleFor(crepe: Crepe, flush: () => void, openFind: (query: string) => void): PageEditorHandle {
  const view = () => crepe.editor.ctx.get(editorViewCtx);
  return {
    focusStart: () => {
      view().dispatch(view().state.tr.setSelection(Selection.atStart(view().state.doc)).scrollIntoView());
      view().focus();
    },
    focusEnd: () => focusEnd(view()),
    focusAt: (x, y) => focusAt(view(), x, y),
    caret: () => (view().hasFocus() ? view().state.selection.head : null),
    placeCaret: (pos) => {
      const { state } = view();
      const at = Math.max(0, Math.min(pos, state.doc.content.size));
      revealPos(view(), at);
      view().dispatch(view().state.tr.setSelection(TextSelection.near(view().state.doc.resolve(at))));
      view().focus();
    },
    showHeading: (text, nth) => {
      const at = headingAt(view().state.doc, text, nth);
      if (at === null) return false;
      revealPos(view(), at);
      const { state } = view();
      view().dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at + 1))));
      (view().nodeDOM(at) as HTMLElement | null)?.scrollIntoView?.({ block: "start" });
      view().focus();
      return true;
    },
    find: (queries) => {
      const doc = view().state.doc;
      const query = queries.find((q) => findMatches(doc, q).length > 0);
      if (query) openFind(query);
    },
    sections: () => listSections(view().state),
    foldAll: (folded) => foldAll(view(), folded),
    showSection: (index) => jumpToSection(view(), index),
    moveSection: (from, to) => moveSection(view(), from, to),
    flush,
    annotationText: () => editorText(view().state.doc),
    selectedWords: (most) => {
      const { from, to, empty } = view().state.selection;
      if (empty) return null;
      const text = editorText(view().state.doc);
      const covered = offsetsOf(text, from, to);
      const words = wordsOf(text.full, covered.from, covered.to, most);
      return words && { words, text };
    },
    caretSection: () => {
      const text = editorText(view().state.doc);
      const { head } = view().state.selection;
      return sectionAtOffset(text, offsetsOf(text, head, head).from);
    },
    showWords: (range, quote) => {
      const text = editorText(view().state.doc);
      const found = text.full.slice(range.from, range.to) === quote ? range : locate(text.full, quote);
      const at = found && positionsOf(text, found);
      if (!at) return false;
      revealPos(view(), at.from);
      const { state } = view();
      view().dispatch(state.tr.setSelection(TextSelection.create(state.doc, at.from, at.to)).scrollIntoView());
      view().focus();
      return true;
    },
    paint: (list) => setPainted(view(), list),
  };
}
