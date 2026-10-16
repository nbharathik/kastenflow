// The page's text as the editor reports it, and what happens when the
// editor is ready: jumps to a heading or line, and the reader's place
// after a reload.

import { useCallback, useState, type RefObject } from "react";

import type { PageEditorHandle } from "../../pages/editor/PageEditor";
import { usePageJumps } from "./jump";
import { setPageView } from "./open-page";
import type { PageSession } from "./page-session";
import type { LoadedNote } from "./use-note-session";

interface PageEditorOptions {
  loaded: LoadedNote;
  session: PageSession;
  journal: boolean;
  compact: boolean;
  headless: boolean;
  editor: RefObject<PageEditorHandle | null>;
  /** The page's text column, inside the scrolling `.kasten-page-main`. */
  bodyRoot: RefObject<HTMLDivElement | null>;
}

export function usePageEditor({ loaded, session, journal, compact, headless, editor, bodyRoot }: PageEditorOptions) {
  const [body, setBody] = useState(loaded.body);
  const onBody = useCallback(
    (next: string) => {
      setBody(next);
      session.editBody(next);
    },
    [session],
  );
  const [editorReady, setEditorReady] = useState(0);
  usePageJumps(session.path, editor, editorReady);
  const onReady = useCallback(
    (handle: PageEditorHandle | null) => {
      editor.current = handle;
      if (handle) setEditorReady((n) => n + 1);
      const scroller = () => bodyRoot.current?.closest<HTMLElement>(".kasten-page-main") ?? null;
      if (!handle) return setPageView(session, null);
      setPageView(session, () => ({ caret: handle.caret(), scroll: scroller()?.scrollTop ?? 0 }));
      // After a reload, go back to where the reader was.
      const { keep } = loaded;
      if (keep) {
        const root = scroller();
        if (root) root.scrollTop = keep.scroll;
        if (keep.caret !== null) handle.placeCaret(keep.caret);
      } else if (journal && !compact && !headless && !loaded.body.trim()) {
        // An empty journal day is there to be written in.
        handle.focusStart();
      }
    },
    [loaded, session, journal, compact, headless],
  );
  return { body, onBody, editorReady, onReady };
}
