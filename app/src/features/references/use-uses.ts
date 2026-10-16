// Where each reference is cited, for the "Cited in" column. Asking costs a
// scan of the pages, so only the rows on screen are asked for, a few at a time,
// and an answer is kept until a page, a deck or the bibliography changes.

import { useEffect, useRef, useState } from "react";

import type { KeyUses } from "../../lib/vault/reference-types";
import { useStamp } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";

/** A value that follows `value` after it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The uses of `keys` as they are read; a key not read yet is missing from the map. */
export function useUses(keys: readonly string[]): ReadonlyMap<string, KeyUses> {
  const client = useWorkspace((s) => s.client);
  const stamp = useSettled(useStamp("notes", "decks", "references"), 800);
  const cache = useRef(new Map<string, KeyUses>());
  const stamped = useRef(stamp);
  const [, shown] = useState(0);
  const wanted = keys.join("\n");

  useEffect(() => {
    if (!client) return;
    if (stamped.current !== stamp) {
      stamped.current = stamp;
      cache.current.clear();
    }
    let cancelled = false;
    void (async () => {
      let since = 0;
      for (const key of wanted.split("\n")) {
        if (cancelled) return;
        if (key === "" || cache.current.has(key)) continue;
        try {
          cache.current.set(key, await client.referenceUses(key));
        } catch {
          // A key that cannot be read has no count; the row shows a dash.
          continue;
        }
        if (++since % 4 === 0) shown((n) => n + 1);
      }
      if (!cancelled) shown((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, stamp, wanted]);

  return cache.current;
}
