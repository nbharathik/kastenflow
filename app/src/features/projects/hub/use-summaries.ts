// The Projects hub's data: every project's summary, read in one call and read
// again when the vault's notes, boards or decks change (the revision counters,
// not a guess from the notes the window holds). A change arrives in bursts while
// someone types, so a re-read waits a moment for the burst to end. The list
// already on screen stays until the new one arrives.

import { useCallback, useEffect, useRef, useState } from "react";

import { dayFrom } from "../../../lib/dates";
import type { ProjectSummary } from "../../../lib/vault/project-types";
import { useStamp } from "../../workspace/revision";
import { useWorkspace } from "../../workspace/store";

/** How long a change waits for more changes before the summaries are read again. */
const SETTLE_MS = 200;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Summaries {
  /** Null until the first answer. */
  list: ProjectSummary[] | null;
  /** When the list was read, so "2 h ago" is worked out against the same moment for every card. */
  now: number;
  /** Why the last read failed; cleared by the next one that works. */
  error: string | null;
  /** Reads again now. */
  reload(): void;
}

export function useSummaries(): Summaries {
  const client = useWorkspace((s) => s.client);
  const stamp = useStamp("notes", "boards", "decks");
  const [state, setState] = useState<Omit<Summaries, "reload">>({ list: null, now: Date.now(), error: null });
  const ticket = useRef(0);

  const load = useCallback(() => {
    if (!client) return;
    const mine = ++ticket.current;
    // `Promise.resolve().then` turns a call that throws at once into a failed read.
    void Promise.resolve()
      .then(() => client.projectSummaries(dayFrom()))
      .then(
        (list) => {
          if (mine === ticket.current) setState({ list, now: Date.now(), error: null });
        },
        (err: unknown) => {
          if (mine === ticket.current) setState((s) => ({ ...s, error: message(err) }));
        },
      );
  }, [client]);

  // The first read, and a read for another vault.
  useEffect(() => {
    load();
    return () => {
      ticket.current++;
    };
  }, [load]);

  const seen = useRef(stamp);
  useEffect(() => {
    if (seen.current === stamp) return;
    seen.current = stamp;
    const timer = setTimeout(load, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [stamp, load]);

  return { ...state, reload: load };
}
