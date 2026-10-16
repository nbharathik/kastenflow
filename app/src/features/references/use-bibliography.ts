// The vault's bibliography in the window: read when a view opens and again
// whenever a `.bib` file changes (the vault's `references` counter), whoever
// changed it, and on `reload()` after the view's own edits.

import { useCallback, useEffect, useState } from "react";

import type { Bibliography } from "../../lib/vault/reference-types";
import { useStamp } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";

export interface BibliographyState {
  /** Null until the first answer. */
  bib: Bibliography | null;
  /** Why it could not be read. */
  error: string | null;
  reload(): void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useBibliography(): BibliographyState {
  const client = useWorkspace((s) => s.client);
  const stamp = useStamp("references");
  const [asked, setAsked] = useState(0);
  const [state, setState] = useState<{ bib: Bibliography | null; error: string | null }>({ bib: null, error: null });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.bibliography().then(
      (bib) => !cancelled && setState({ bib, error: null }),
      (err: unknown) => !cancelled && setState((was) => ({ bib: was.bib, error: message(err) })),
    );
    return () => {
      cancelled = true;
    };
  }, [client, stamp, asked]);

  const reload = useCallback(() => setAsked((n) => n + 1), []);
  return { ...state, reload };
}
