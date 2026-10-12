// Loads a note and keeps a PageSession for it while its page is open:
// reloads after a conflict, a merge or a change on disk, follows renames,
// writes what is waiting when the page closes or the window loses focus,
// and has the core commit the typing on leaving the page. Typing not yet
// written is kept on this computer too (unsaved.ts) and put back when the
// page opens after a crash.

import { useCallback, useEffect, useRef, useState } from "react";

import { useShell } from "../../../lib/store";
import type { NoteFile, VaultClient } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { isDraft, nowAt } from "../drafts";
import { useWorkspace } from "../store";
import { flushOpenPage, pageView, passTyping, registerPage, type PageView } from "./open-page";
import { PageSession } from "./page-session";
import { keepUnsaved, toRestore, unsavedFor, writeUnsavedNow } from "./unsaved";

export interface LoadedNote {
  note: NoteFile;
  prefix: string;
  /** What the editor shows: the note's body, or typing waiting to be written. */
  body: string;
  /** Changes on every (re)load, so the editor starts again. */
  version: number;
  /** Where the reader was, when this is a reload. */
  keep: PageView | null;
}

export { flushOpenPage };

export function useNoteSession(client: VaultClient, path: string) {
  const [loaded, setLoaded] = useState<LoadedNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const session = useRef<PageSession | null>(null);
  const forget = useRef<(() => void) | null>(null);
  const version = useRef(0);

  /** Writes a session's last edits; leaving the note also commits them. */
  const finish = useCallback(
    (last: PageSession | null, leaving: boolean) => {
      if (!last) return;
      void last.close().then(() => {
        if (leaving) void client.commitEdits().catch(() => {});
      });
    },
    [client],
  );

  const start = useCallback(
    (note: NoteFile, keep: PageView | null = null, pending: string | null = null) => {
      passTyping(session.current);
      finish(session.current, session.current !== null && session.current.path !== note.meta.path);
      const workspace = useWorkspace.getState();
      const kept = client.kind === "preview";
      // Typing a crash kept from being written goes back in, based on the
      // version it was typed on, so its save joins the two or keeps a copy.
      let base = note;
      let restored = false;
      if (pending === null && !kept) {
        const unsaved = unsavedFor(note.meta.path);
        const what = toRestore(unsaved, note, splitFrontmatter(note.text).body);
        if (what === "forget") keepUnsaved(note.meta.path, null);
        if (what === "restore" && unsaved) {
          base = { ...note, hash: unsaved.base };
          pending = unsaved.body;
          restored = true;
        }
      }
      const next = new PageSession(client, note.meta.path, base, {
        onState: (state) => useShell.getState().setSaveState(next.path, state),
        onNote: (saved) => workspace.noteChanged(saved.meta),
        onRenamed: (from, renamed) => {
          if (!kept) keepUnsaved(from, null);
          void useWorkspace.getState().renamed(from, renamed);
        },
        onUnsaved: (body, hash) => {
          // A draft's typing makes its page within moments; it has no path to keep it under.
          if (!kept && !isDraft(next.path)) keepUnsaved(next.path, body === null ? null : { body, base: hash, id: note.meta.id, at: Date.now() });
        },
        onConflict: (copy, current) => {
          setConflict(copy);
          void useWorkspace.getState().refresh();
          start(current);
        },
        onMerged: (merged, waiting) => {
          start(merged, pageView(next), waiting);
          useWorkspace.getState().toast("This page also changed outside KastenFlow; both edits were kept");
        },
        onError: (message) => useWorkspace.getState().toast(`Could not save: ${message}`),
        onRecovered: (kept, title) => {
          const ws = useWorkspace.getState();
          ws.noteChanged(kept.meta);
          ws.toast(`“${title}” was moved or deleted outside KastenFlow while you typed; your text is in “${kept.meta.title}”`, {
            label: "Open",
            run: () => useWorkspace.getState().openPath(kept.meta.path),
          });
        },
      });
      session.current = next;
      /** Reloads when the file changed on disk and no edits are waiting; a
       * save with edits waiting merges instead. */
      const check = () => {
        passTyping(next);
        if (next.busy) return;
        client.read(next.path).then(
          (fresh) => {
            if (session.current === next && !next.busy && fresh.hash !== next.currentHash) {
              start(fresh, pageView(next));
              useWorkspace.getState().toast("This page changed outside KastenFlow, so it was updated");
            }
          },
          () => {},
        );
      };
      forget.current?.();
      forget.current = registerPage(
        next,
        () => {
          if (session.current === next) void client.read(next.path).then((fresh) => start(fresh, pageView(next)), () => {});
        },
        check,
      );
      useShell.getState().setSaveState(next.path, pending === null ? "saved" : "edited");
      const { prefix, body } = splitFrontmatter(note.text);
      if (pending !== null) next.editBody(pending);
      setLoaded({ note, prefix, body: pending ?? body, version: ++version.current, keep });
      setError(null);
      if (restored) useWorkspace.getState().toast("Typing that wasn't saved when KastenFlow last closed was put back");
    },
    [client, finish],
  );

  useEffect(() => {
    // A rename moved the open note, or its draft became it: the session
    // already follows it.
    if (session.current && nowAt(session.current.path) === nowAt(path)) return;
    setConflict(null);
    let cancelled = false;
    client.read(path).then(
      (note) => !cancelled && start(note),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [client, path, start]);

  useEffect(
    () => () => {
      // The page's own cleanups run after this one: its editor is still
      // there to hand over what was typed in its last moments.
      passTyping(session.current);
      forget.current?.();
      forget.current = null;
      finish(session.current, true);
    },
    [finish],
  );

  // Save when the window goes to the background; pick up changes made on
  // disk while it was there.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      passTyping(session.current);
      void session.current?.flush();
      writeUnsavedNow();
    };
    const onFocus = () => {
      const current = session.current;
      passTyping(current);
      if (current) void client.read(current.path).then(
        (fresh) => {
          if (session.current === current && !current.busy && fresh.hash !== current.currentHash) start(fresh, pageView(current));
        },
        () => {},
      );
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onHide);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onHide);
      window.removeEventListener("focus", onFocus);
    };
  }, [client, start]);

  return { loaded, error, conflict, dismissConflict: () => setConflict(null), session, reload: start };
}
