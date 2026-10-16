// The saved collections in the window: read when the view opens and again
// whenever a `views/*.yaml` file is added, changed or removed (the vault's
// `collections` counter), whoever did it.

import { useCallback, useEffect, useState } from "react";

import type { Collection } from "../../lib/vault/collection-types";
import { useStamp } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";

export interface CollectionList {
  /** Null until the first answer. */
  list: Collection[] | null;
  /** Why the list could not be read. */
  error: string | null;
  reload(): void;
}

export function useCollections(): CollectionList {
  const client = useWorkspace((s) => s.client);
  const stamp = useStamp("collections");
  const [asked, setAsked] = useState(0);
  const [state, setState] = useState<{ list: Collection[] | null; error: string | null }>({ list: null, error: null });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.collections().then(
      (list) => !cancelled && setState({ list, error: null }),
      (err: unknown) => !cancelled && setState((was) => ({ list: was.list ?? [], error: err instanceof Error ? err.message : String(err) })),
    );
    return () => {
      cancelled = true;
    };
  }, [client, stamp, asked]);

  const reload = useCallback(() => setAsked((n) => n + 1), []);
  return { ...state, reload };
}

/** The collection at `path` among `list`. */
export const collectionAt = (list: readonly Collection[] | null, path: string | undefined): Collection | undefined => (path ? list?.find((c) => c.path === path) : undefined);
