// What agents did today, read for Home's strip and its "Agents today" card
// from one place, so the two ask once. It reads when Home opens and at
// midnight, then again 2 seconds after the notes stop changing (an agent is
// writing; the person's own typing counts as change too, so it waits for a
// quiet moment). While the window is hidden it waits until it is shown.

import { useEffect, useRef } from "react";
import { create } from "zustand";

import { useToday } from "../../lib/use-today";
import type { Digest, VaultClient } from "../../lib/vault/types";
import { message } from "../review/store";
import { useWorkspace } from "../workspace/store";
import { startOfToday } from "./agents-today";

/** Quiet time after the last change before the digest is read again. */
export const DEBOUNCE_MS = 2000;

interface DigestState {
  digest: Digest | null;
  error: string | null;
  client: VaultClient | null;
}

export const useDigest = create<DigestState>(() => ({ digest: null, error: null, client: null }));

let reads = 0;
let inflight: Promise<void> | null = null;

/** Reads the digest; one already being read is waited for, unless `force`d. */
export function loadDigest(client: VaultClient | null, force = false): Promise<void> {
  if (!client) return Promise.resolve();
  if (useDigest.getState().client !== client) {
    inflight = null;
    useDigest.setState({ digest: null, error: null, client });
  }
  if (inflight && !force) return inflight;
  const read = ++reads;
  const now = (async () => {
    try {
      const found = await client.activityDigest(startOfToday());
      if (read === reads) useDigest.setState({ digest: found, error: null });
    } catch (err) {
      if (read === reads) useDigest.setState({ error: message(err) });
    }
  })().finally(() => {
    if (inflight === now) inflight = null;
  });
  inflight = now;
  return now;
}

const shown = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** The digest of today, kept up to date as described above. */
export function useAgentDigest(): { digest: Digest | null; error: string | null; reload(): Promise<void> } {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const today = useToday();
  const digest = useDigest((s) => s.digest);
  const error = useDigest((s) => s.error);
  const first = useRef(true);

  // At once: Home opens, the vault changes, or the day turns.
  useEffect(() => {
    void loadDigest(client);
  }, [client, today]);

  // Later: a quiet 2 s after the notes last changed, and not while hidden.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let late = false;
    const read = () => void loadDigest(client);
    const timer = setTimeout(() => {
      if (shown()) read();
      else late = true;
    }, DEBOUNCE_MS);
    const onShown = () => {
      if (late && shown()) {
        late = false;
        read();
      }
    };
    document.addEventListener("visibilitychange", onShown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShown);
    };
  }, [client, notes]);

  return { digest: useDigest.getState().client === client ? digest : null, error: useDigest.getState().client === client ? error : null, reload: () => loadDigest(client, true) };
}
