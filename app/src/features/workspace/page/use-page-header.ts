// The page's title and header keys while they are being typed, and what
// the session does with them before it writes, closes or reloads.

import { useEffect, useRef, useState, type RefObject } from "react";

import type { PageEditorHandle } from "../../pages/editor/PageEditor";
import { readPageMeta, type MetaKey, type PageMeta } from "../../pages/page/page-meta";
import { setPagePass } from "./open-page";
import type { PageSession } from "./page-session";
import type { LoadedNote } from "./use-note-session";

export function usePageHeader(loaded: LoadedNote, session: PageSession, journal: boolean, editor: RefObject<PageEditorHandle | null>) {
  const [header, setHeader] = useState<PageMeta>(() => readPageMeta(loaded.prefix));
  const committed = useRef(header.title);
  const typedTitle = useRef(header.title);
  const [freshPage] = useState(() => !loaded.body.trim() && !header.title.trim());

  const onHeader = (key: MetaKey, value: string | null) => {
    setHeader((h) => ({ ...h, [key]: value ?? "" }));
    if (key === "title") typedTitle.current = value ?? "";
    else session.editHeader(key, value);
  };
  const onTitleDone = () => {
    const title = header.title.trim();
    if (!title) return setHeader((h) => ({ ...h, title: committed.current }));
    if (title === committed.current) return;
    committed.current = title;
    session.rename(title);
    void session.flush();
  };

  // Before the session writes, closes or reloads: the editor's last moments
  // of typing, and a title typed but never left (a closing page has no blur).
  useEffect(() => {
    setPagePass(session, () => {
      editor.current?.flush();
      const title = typedTitle.current.trim();
      if (journal || !title || title === committed.current) return;
      committed.current = title;
      session.rename(title);
    });
    return () => setPagePass(session, null);
  }, [session, journal]);

  return { header, freshPage, onHeader, onTitleDone };
}
