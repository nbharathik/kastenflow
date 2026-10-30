// "Insert citation": the vault's References (and the document's own `.bib`
// files) in a list; the one chosen is written as `\cite{key}` at the caret,
// or as a key added to the citation the caret is in.

import type { RefObject } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { citationText } from "./cite-insert";
import type { AssistIndex } from "./completion/data";
import type { EditorHandle } from "./editor/Editor";
import { openPicker, type PickerItem } from "./picker";

/** The references as list rows: the title, with who and when and the key beside it. */
export async function referenceRows(index: Pick<AssistIndex, "cites">): Promise<PickerItem[]> {
  return (await index.cites()).map((c) => ({ id: c.key, label: c.title || c.key, detail: c.title ? `${c.detail} · ${c.key}` : c.detail }));
}

/** Writes the citation for `key` at the caret (in place of the selection), and puts the keyboard back in the text. */
export function writeCitation(editor: EditorHandle | null, key: string): boolean {
  const view = editor?.view();
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const text = citationText(view.state.sliceDoc(line.from, from), view.state.sliceDoc(to, line.to), key);
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
  return true;
}

export function insertCitation(index: Pick<AssistIndex, "cites">, editor: RefObject<EditorHandle | null>): void {
  openPicker({
    title: "Insert a citation",
    placeholder: "Search your references",
    load: () => referenceRows(index),
    empty: { text: "You have no references yet. Add a paper in References, then come back.", action: { label: "Open References", run: () => useWorkspace.getState().go({ view: "references" }) } },
    onPick: (item) => {
      if (!writeCitation(editor.current, item.id)) useWorkspace.getState().toast("Open a file of the document first, then insert the citation.");
    },
  });
}
