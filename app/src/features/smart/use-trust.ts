// Who made a smart page and whether a person has to allow it to run, read
// from the app, and the person's "Allow to run".

import { useCallback, useEffect, useState } from "react";

import type { SmartBackend, Trust } from "./backend";

export interface TrustState {
  /** null while the app is asked. */
  trust: Trust | null;
  /** A person's click: the app keeps it for this page. */
  allow(): Promise<void>;
  busy: boolean;
  /** One sentence when the app could not keep the choice. */
  problem: string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : typeof err === "string" ? err : "That did not work.");

/** `pagePath` is the smart page. `active` false asks nothing (a page that is not a smart page). */
export function useTrust(pagePath: string, backend: SmartBackend, active = true): TrustState {
  const [trust, setTrust] = useState<Trust | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    setTrust(null);
    backend.trust(pagePath).then(
      (found) => live && setTrust(found),
      // Unreadable: the app decides again when the page starts, and says why if it refuses.
      () => live && setTrust({ madeBy: null, needsAllow: false, allowed: false }),
    );
    return () => {
      live = false;
    };
  }, [backend, pagePath, active]);

  const allow = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      await backend.allowRun(pagePath);
      setTrust((was) => (was ? { ...was, needsAllow: false, allowed: true } : was));
    } catch (err) {
      setProblem(message(err));
    }
    setBusy(false);
  }, [backend, pagePath]);

  return { trust, allow, busy, problem };
}
