// What the open LaTeX document gives the chat: its selection while the editor
// is on screen, "Fix with AI" for what the last build complained about, and
// "Fix this one" and "Explain" for a single problem (from the problem list and
// the marks in the text).

import { type RefObject, useCallback, useEffect } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { addSelectionReader, askAboutProblem, fixWithAi, latexSelection } from "./chat";
import { aiAsk } from "./completion/binding";
import { useDiagnostics } from "./diagnostics";
import type { EditorHandle } from "./editor/Editor";
import { fixAction, NOTHING_TO_FIX } from "./fixable";
import type { Diagnostic } from "./types";

export interface LatexChat {
  /** Fix what the last build complained about: errors first, else references and boxes. */
  fix(): void;
  /** Fix one problem. */
  fixOne(problem: Diagnostic): void;
  /** Explain one problem, changing nothing. */
  explain(problem: Diagnostic): void;
}

/** `open` is the file in the editor (a vault path) and `folder` its document's. */
export function useLatexChat(editor: RefObject<EditorHandle | null>, open: string | null, folder: string, main = "main.tex"): LatexChat {
  useEffect(() => {
    if (!open) return;
    return addSelectionReader(() => latexSelection(editor.current?.view() ?? null, open));
  }, [editor, open]);

  const fix = useCallback(() => {
    if (!open) return;
    const slug = fixAction(useDiagnostics.getState().byDoc[folder] ?? []);
    if (!slug) {
      useWorkspace.getState().toast(NOTHING_TO_FIX);
      return;
    }
    void fixWithAi(open, latexSelection(editor.current?.view() ?? null, open), slug);
  }, [editor, open, folder]);

  const fixOne = useCallback((problem: Diagnostic) => void askAboutProblem("fix", problem, folder, main), [folder, main]);
  const explain = useCallback((problem: Diagnostic) => void askAboutProblem("explain", problem, folder, main), [folder, main]);

  // The marks in the text ask through here too.
  useEffect(() => {
    const ask = (kind: "fix" | "explain", problem: Diagnostic) => void askAboutProblem(kind, problem, folder, main);
    aiAsk.current = ask;
    // The marks already in the text are made again with the new way to ask.
    useDiagnostics.setState({});
    return () => {
      if (aiAsk.current === ask) aiAsk.current = null;
    };
  }, [folder, main]);

  return { fix, fixOne, explain };
}
