// Ties the editing aids to the open document: the index that completion and the
// outline read, the binding the editor's extensions use, and the jumps between
// source and PDF (forward, inverse, from the problem list and the outline).
// The workspace calls this once and uses what it returns.

import { EditorSelection } from "@codemirror/state";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { MANAGED_BIB } from "../../lib/vault/reference-types";
import { installAssist } from "./assist";
import type { LatexBackend } from "./backend";
import { bindAssist } from "./completion/binding";
import { citesFromEntries, mergeCites } from "./completion/cites";
import { AssistIndex } from "./completion/data";
import type { EditorHandle } from "./editor/Editor";
import type { PreviewHandle } from "./PreviewPane";
import type { Session } from "./session";
import { syncForward, syncInverse } from "./sync";

installAssist();

/** The vault's References as completion items; nothing when there is no vault client (the browser preview). */
async function vaultCites() {
  const client = useWorkspace.getState().client;
  if (!client) return [];
  const bib = await client.bibliography();
  return mergeCites(citesFromEntries(bib.managed.entries, MANAGED_BIB), ...bib.external.map((f) => citesFromEntries(f.entries, f.path)));
}

interface Inputs {
  session: Session;
  backend: LatexBackend;
  editor: RefObject<EditorHandle | null>;
  preview: RefObject<PreviewHandle | null>;
  /** The file open in the editor (full path). */
  open: string | null;
  side: RefObject<HTMLElement | null>;
  source: RefObject<HTMLElement | null>;
}

export function useAssist({ session, backend, editor, preview, open, side, source }: Inputs) {
  const say = useWorkspace.getState().toast;
  const folder = session.doc.folder;
  const index = useMemo(
    () => new AssistIndex({ folder, files: () => session.snapshot().files, read: async (path) => (await backend.source(path)).text, vaultCites }),
    [session, backend, folder],
  );
  useEffect(() => () => index.dispose(), [index]);
  // A file just opened is scanned at once; typing is told through `edited`.
  useEffect(() => {
    if (open) index.setText(open, session.textOf(open), true);
  }, [index, session, open]);

  const jump = useRef<{ path: string; line: number } | null>(null);
  const goTo = useCallback(
    (path: string, line: number) => {
      if (session.snapshot().open === path) editor.current?.goToLine(line);
      else {
        jump.current = { path, line };
        void session.openFile(path);
      }
    },
    [session, editor],
  );
  // The editor has switched to the file by the time this runs (children's effects first).
  useEffect(() => {
    const wanted = jump.current;
    if (wanted && wanted.path === open) {
      jump.current = null;
      editor.current?.goToLine(wanted.line);
    }
  }, [open, editor]);

  const toPdf = useCallback(
    (path: string | null, line: number) =>
      syncForward({ where: (p, l) => session.whereInPdf(p, l), show: async (hit) => preview.current?.showHit(hit), say }, path, line),
    [session, preview, say],
  );
  const fromPdf = useCallback(
    (point: { page: number; x: number; y: number }) =>
      syncInverse({ folder, files: () => session.snapshot().files, inverse: (p, x, y) => backend.syncInverse(folder, p, x, y), goTo, say }, point),
    [session, backend, folder, goTo, say],
  );

  useLayoutEffect(() => {
    const release = bindAssist({
      index,
      folder,
      main: session.doc.main,
      currentFile: () => session.snapshot().open,
      syncToPdf: (path, line) => void toPdf(path, line),
    });
    return release;
  }, [index, folder, session, toPdf]);

  const addSection = useCallback(() => {
    const view = editor.current?.view();
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const head = line.to + 10;
    view.dispatch({ changes: { from: line.to, insert: "\n\\section{Title}\n" }, selection: EditorSelection.range(head, head + 5), scrollIntoView: true });
    view.focus();
  }, [editor]);

  const focusIn = (root: RefObject<HTMLElement | null>, selector: string) => root.current?.querySelector<HTMLElement>(selector)?.focus();
  return {
    index,
    goTo,
    toPdf,
    fromPdf,
    addSection,
    focusOutline: () => focusIn(side, ".latex-outline button"),
    focusProblems: () => focusIn(source, ".latex-problems button"),
  };
}
