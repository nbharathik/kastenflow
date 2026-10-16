// Running the open collection in the window: again whenever the collection
// changes, the vault's notes or tags change, or the day does. A run that
// has been overtaken by a newer one is dropped.

import { useEffect, useState } from "react";

import { dayFrom } from "../../lib/dates";
import type { Collection } from "../../lib/vault/collection-types";
import type { TagSchema } from "../../lib/vault/types";
import { usePrefs } from "../workspace/prefs";
import { useStamp } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";
import { runCollection, type CollectionRun } from "./run";

export interface RunState {
  run: CollectionRun | null;
  error: string | null;
  /** The tags' schemas, for the columns' kinds. */
  schemas: TagSchema[];
  loading: boolean;
}

export function useCollectionRun(collection: Collection | undefined): RunState {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const weekStart = usePrefs((s) => s.weekStart);
  const tags = useStamp("tags");
  const [schemas, setSchemas] = useState<TagSchema[]>([]);
  const [state, setState] = useState<{ key: string; run: CollectionRun | null; error: string | null }>({ key: "", run: null, error: null });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.tagSchemas().then(
      (list) => !cancelled && setSchemas(list),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, tags]);

  const key = collection && !collection.problem ? `${collection.path}|${collection.hash}` : "";
  const day = dayFrom();
  useEffect(() => {
    if (!client || !collection || key === "") return;
    let cancelled = false;
    runCollection(client, collection, notes, day, weekStart, schemas).then(
      (run) => !cancelled && setState({ key, run, error: null }),
      (err: unknown) => !cancelled && setState({ key, run: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
    // The collection is read by its hash (in `key`): an edit changes it, a reload with the same text does not.
  }, [client, key, notes, weekStart, schemas, day]);

  const current = state.key === key ? state : { run: null, error: null };
  return { run: current.run, error: current.error, schemas, loading: key !== "" && state.key !== key };
}
