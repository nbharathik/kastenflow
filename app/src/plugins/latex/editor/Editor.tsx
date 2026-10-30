// The source editor: one CodeMirror view for the open file. Each file keeps
// its own state (so undo history stays with the file) while it is open in the
// session. The owner hears changes through `hooks` and can replace the text
// (after a merge, or when the disk's file is chosen) or move to a line through
// the handle. A switch of light and dark reconfigures the theme in place.

import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { codemirrorTheme } from "../../../ui/codemirror-theme";
import { createState, type EditorHooks, themeSlot } from "./setup";

export interface EditorHandle {
  /** Replaces the whole text (keeping the caret where it can). */
  replaceText(text: string): void;
  /** Puts the caret on a line (1-based) and scrolls to it. */
  goToLine(line: number): void;
  /** The line the caret is on (1-based). */
  caretLine(): number;
  focus(): void;
  view(): EditorView | null;
  /** Drops what is kept for a file that is not shown (its text changed behind the editor's back). */
  forget(fileKey: string): void;
}

interface Props {
  /** The open file; switching it switches the state. */
  fileKey: string;
  /** The file's text, used when the file is first opened here. */
  initial: string;
  hooks: EditorHooks;
  label: string;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ fileKey, initial, hooks, label }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const current = useRef<string | null>(null);
  const hookRef = useRef(hooks);
  hookRef.current = hooks;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const created = new EditorView({ parent: host.current ?? undefined });
    view.current = created;
    const reflect = () => created.dispatch({ effects: themeSlot.reconfigure(codemirrorTheme()) });
    const watch = new MutationObserver(reflect);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const cache = states.current;
    return () => {
      watch.disconnect();
      created.destroy();
      view.current = null;
      cache.clear();
      current.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (current.current !== null) states.current.set(current.current, v.state);
    current.current = fileKey;
    const known = states.current.get(fileKey);
    v.setState(known ?? createState(initialRef.current, () => hookRef.current, label));
    // Colours follow the page as it is now, not as it was when this file's state was made.
    v.dispatch({ effects: themeSlot.reconfigure(codemirrorTheme()) });
  }, [fileKey, label]);

  useImperativeHandle(
    ref,
    () => ({
      replaceText(text) {
        const v = view.current;
        if (!v || v.state.doc.toString() === text) return;
        const caret = Math.min(v.state.selection.main.head, text.length);
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: EditorSelection.cursor(caret) });
      },
      goToLine(line) {
        const v = view.current;
        if (!v) return;
        const at = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
        v.dispatch({ selection: EditorSelection.cursor(at.from), effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
        v.focus();
      },
      caretLine: () => view.current?.state.doc.lineAt(view.current.state.selection.main.head).number ?? 1,
      focus: () => view.current?.focus(),
      view: () => view.current,
      forget: (key) => {
        if (key !== current.current) states.current.delete(key);
      },
    }),
    [],
  );

  return <div ref={host} className="latex-editor" data-testid="latex-editor" />;
});
