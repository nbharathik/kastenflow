// The library as the Layout menu sees it. A menu's rows are built when it opens and cannot wait for the host, so the last library read is
// kept here, per host, by a hook that lives as long as the editor (the title bar's). A host without a library has nothing here.

import { useEffect } from "react";

import type { EditorSession } from "../session/session.ts";
import type { LayoutLibraryHost } from "./library-host.ts";
import { type LibraryItem, useLibrary } from "./library-state.ts";

const kept = new WeakMap<LayoutLibraryHost, LibraryItem[]>();

/** The entries of the host's library as last read; none before the first read, or for a host that has no library. */
export function keptLibrary(host: LayoutLibraryHost | undefined): readonly LibraryItem[] {
  return (host && kept.get(host)) ?? [];
}

/** Reads the session's library (and again when the host says it changed) and keeps what was read for the Layout menu. */
export function useKeptLibrary(session: EditorSession): void {
  const host = session.host.layoutLibrary;
  const { state, items } = useLibrary(session);
  useEffect(() => {
    if (host && state === "ready") kept.set(host, items);
  }, [host, state, items]);
}
