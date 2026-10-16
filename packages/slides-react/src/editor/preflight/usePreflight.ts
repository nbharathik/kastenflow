import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorSession } from "../session/session.ts";
import { runPreflight } from "./preflight.ts";
import type { PreflightFormat, PreflightOptions, PreflightReport } from "./types.ts";

/**
 * The check for `format`, run when the view that shows it opens and again when asked (`check(true)` looks at the web addresses too). A
 * check that was overtaken by a newer one is forgotten.
 */
export function usePreflight(session: EditorSession, format: PreflightFormat): { report: PreflightReport | null; checking: boolean; failed: string | null; check(network?: boolean): void } {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef(0);
  const live = useRef(true);

  const check = useCallback(
    (network = false) => {
      const mine = ++latest.current;
      setChecking(true);
      setFailed(null);
      const options: PreflightOptions = network ? { network: true } : {};
      runPreflight(session, session.host, format, options).then(
        (found) => {
          if (live.current && mine === latest.current) {
            setReport(found);
            setChecking(false);
          }
        },
        (thrown: unknown) => {
          if (live.current && mine === latest.current) {
            setFailed(thrown instanceof Error ? thrown.message : String(thrown));
            setChecking(false);
          }
        },
      );
    },
    [session, format],
  );

  useEffect(() => {
    live.current = true;
    check();
    return () => {
      live.current = false;
    };
  }, [check]);

  return { report, checking, failed, check };
}
