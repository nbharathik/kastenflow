// The graph for a scope, fetched from the vault and fetched again when the
// notes change (a moment after the last change, so typing in another pane
// does not ask the core for a graph on every key).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GraphScope, NoteMeta, VaultGraph } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { scopeKey } from "./graph-model";

/** Changes when any note is added, removed or changed. */
export function notesStamp(notes: readonly NoteMeta[]): string {
  let latest = 0;
  for (const n of notes) if (n.modified > latest) latest = n.modified;
  return `${notes.length}:${latest}`;
}

/** How long after the notes last changed the graph is asked for again. */
const SETTLE_MS = 400;

export interface LoadedGraph {
  graph: VaultGraph | null;
  error: string | null;
  /** Asks again now. */
  reload(): void;
}

/** The graph of `scope` (none while `scope` is null), by the scope's key, so a new scope never shows the last one's nodes. */
export function useVaultGraph(scope: GraphScope | null): LoadedGraph {
  const client = useWorkspace((s) => s.client);
  const stamp = useWorkspace((s) => notesStamp(s.notes));
  const key = scope ? scopeKey(scope) : "";
  const [loaded, setLoaded] = useState<{ key: string; graph: VaultGraph } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const kept = useRef(scope);
  const showing = useRef("");
  const asks = useRef(0);

  useEffect(() => {
    kept.current = scope;
  });

  useEffect(() => {
    const wanted = kept.current;
    if (!client || !wanted) return;
    let live = true;
    // The first graph of a scope, and one asked for by name, come at once; one the notes' changes ask for waits for them to go quiet.
    const asked = asks.current !== round;
    asks.current = round;
    const wait = showing.current === key && !asked ? SETTLE_MS : 0;
    const timer = setTimeout(() => {
      client.graph(wanted).then(
        (graph) => {
          if (!live) return;
          showing.current = key;
          setLoaded({ key, graph });
          setError(null);
        },
        (err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : String(err));
        },
      );
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, key, stamp, round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return useMemo(() => ({ graph: loaded && loaded.key === key ? loaded.graph : null, error, reload }), [loaded, key, error, reload]);
}
