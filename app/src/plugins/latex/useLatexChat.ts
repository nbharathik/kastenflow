// What the open LaTeX document gives the chat: its selection while the editor
// is on screen, and "Fix with AI" for the errors of the last build.

import { type RefObject, useCallback, useEffect } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { addSelectionReader, fixWithAi, latexSelection } from "./chat";
import { useDiagnostics } from "./diagnostics";
import type { EditorHandle } from "./editor/Editor";

/** `open` is the file in the editor (a vault path) and `folder` its document's. */
export function useLatexChat(editor: RefObject<EditorHandle | null>, open: string | null, folder: string): { fix(): void } {
  useEffect(() => {
    if (!open) return;
    return addSelectionReader(() => latexSelection(editor.current?.view() ?? null, open));
  }, [editor, open]);

  const fix = useCallback(() => {
    if (!open) return;
    const errors = (useDiagnostics.getState().byDoc[folder] ?? []).some((d) => d.severity === "error");
    if (!errors) {
      useWorkspace.getState().toast("The last build has no errors to fix.");
      return;
    }
    void fixWithAi(open, latexSelection(editor.current?.view() ?? null, open));
  }, [editor, open, folder]);

  return { fix };
}
