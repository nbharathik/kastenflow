// The library as the editor's panels see it: the host's entries, read, loaded when a panel opens and again when the host says the library
// changed. A host without a library is a view that is "none"; one that fails is "failed" with a way to try again.

import { useCallback, useEffect, useState } from "react";

import type { EditorSession } from "../session/session.ts";
import type { LayoutLibraryHost, LibraryEntry } from "./library-host.ts";
import { readEntry } from "./library-ops.ts";
import type { LibraryLayout } from "./library.ts";

export interface LibraryItem {
  entry: LibraryEntry;
  layout: LibraryLayout;
}

export interface LibraryView {
  state: "none" | "loading" | "ready" | "failed";
  items: LibraryItem[];
  /** Reads the library again. */
  reload(): void;
}

/** The entries of the library that can be used, in the host's order: one whose file is not a layout is left out. */
export async function loadLibrary(host: LayoutLibraryHost): Promise<LibraryItem[]> {
  const entries = await host.list();
  const read = await Promise.all(entries.map(async (entry) => ({ entry, layout: await readEntry(host, entry.id) })));
  return read.flatMap(({ entry, layout }) => (layout ? [{ entry, layout }] : []));
}

/** The library of the session's host, loaded now and whenever the host reports a change. */
export function useLibrary(session: EditorSession): LibraryView {
  const host = session.host.layoutLibrary;
  const [loaded, setLoaded] = useState<{ host: LayoutLibraryHost | undefined; state: LibraryView["state"]; items: LibraryItem[] }>({ host, state: host ? "loading" : "none", items: [] });
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((now) => now + 1), []);

  useEffect(() => {
    if (!host) {
      setLoaded({ host, state: "none", items: [] });
      return;
    }
    let live = true;
    const load = () =>
      loadLibrary(host).then(
        (items) => live && setLoaded({ host, state: "ready", items }),
        () => live && setLoaded((now) => ({ host, state: "failed", items: now.host === host ? now.items : [] })),
      );
    void load();
    const stop = host.watch?.(() => void load());
    return () => {
      live = false;
      stop?.();
    };
  }, [host, round]);

  return { state: loaded.host === host ? loaded.state : host ? "loading" : "none", items: loaded.host === host ? loaded.items : [], reload };
}
