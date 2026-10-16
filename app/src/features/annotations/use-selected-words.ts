// The words selected in the page editor, kept up to date as the selection
// moves. A selection stays in the editor while focus is in a field beside
// it (a comment being written), so the words stay for the field to use.

import { useEffect, useState, type RefObject } from "react";

import type { PageEditorHandle } from "../pages/editor/page-handle";
import type { Words } from "./anchor";

/** What the selection needs of the open editor. */
export type SelectionEditor = Pick<PageEditorHandle, "selectedWords">;

/** The words selected, at most `most` characters of them; null when nothing is. */
export function useSelectedWords(editor: RefObject<SelectionEditor | null>, ready: number, most: number): Words | null {
  const [words, setWords] = useState<Words | null>(null);
  useEffect(() => {
    const read = () => {
      const now = editor.current?.selectedWords(most)?.words ?? null;
      setWords((was) => (was?.quote === now?.quote && was?.from === now?.from ? was : now));
    };
    read();
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [editor, ready, most]);
  return words;
}
