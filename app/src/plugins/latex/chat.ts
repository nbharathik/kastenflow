// LaTeX and the chat. What is selected in the source editor becomes a chip like
// a page's selection does (the chat asks the sources in turn; this one answers
// while a document is open), and "Fix with AI" starts a chat about the open file
// that puts right what the last build complained about. The chat reads the file,
// its hash and the build's errors itself when the message is sent; nothing of
// the document's text is copied here.

import type { EditorView } from "@codemirror/view";

import { latexChip } from "../../features/chat/context";
import { runInChat } from "../../features/chat/run-action";
import { selectionChip } from "../../features/chat/selection/chip";
import { MIN_SELECTION, registerSelectionSource, type SelectionSnapshot } from "../../features/chat/selection/sources";
import type { Chip } from "../../features/chat/thread";
import { inFocusedPane } from "../../lib/keys";
import { isShown } from "../../shell/visible-dom";
import { scanOutline } from "./completion/scan";

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** What is selected in `view` (the editor of the file at `path`), when the editor is on screen in the focused pane. */
export function latexSelection(view: EditorView | null, path: string): SelectionSnapshot | null {
  if (!view) return null;
  // Only the document in the focused pane (or the only one), as for a page: a tab kept ready out of sight is skipped.
  if (!view.dom.closest(".kasten-pane") || !inFocusedPane(view.dom) || !isShown(view.dom)) return null;
  const { from, to, empty } = view.state.selection.main;
  if (empty) return null;
  const heading = scanOutline(view.state.sliceDoc(0, from)).at(-1)?.title;
  return { source: { kind: "latex", path }, text: view.state.sliceDoc(from, to), range: { from, to }, ...(heading ? { heading } : {}), title: nameOf(path) };
}

/** Answers what is selected in one open editor, or none. */
export type SelectionReader = () => SelectionSnapshot | null;

const readers = new Set<SelectionReader>();
let withdraw: (() => void) | null = null;

/** The first open editor that has a selection. */
function current(): SelectionSnapshot | null {
  for (const read of readers) {
    const found = read();
    if (found) return found;
  }
  return null;
}

/** Makes `read` one of the editors the chat takes a selection from, for as long as it is open. Two documents side by side share the one LaTeX source the chat knows. Answers how to take it away. */
export function addSelectionReader(read: SelectionReader): () => void {
  readers.add(read);
  withdraw ??= registerSelectionSource("latex", current);
  return () => {
    readers.delete(read);
    if (readers.size === 0) {
      withdraw?.();
      withdraw = null;
    }
  };
}

/** A chat about the file at `path`, asked to fix the errors of the last build; the selected passage goes with it. What it changes waits in the chat for the person to look at. */
export function fixWithAi(path: string, selection: SelectionSnapshot | null): Promise<boolean> {
  const chips: Chip[] = [latexChip({ path, title: nameOf(path) })];
  if (selection && selection.text.trim().length >= MIN_SELECTION) chips.push(selectionChip(selection, true));
  return runInChat("fix-latex-errors", chips);
}
