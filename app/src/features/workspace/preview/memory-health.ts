// The browser preview's health report: the same fields kasten-core's `health`
// returns, filled from what the preview holds. It keeps no history, backup or
// index, so those read as off.

import type { Health } from "../../../lib/vault/health-types";
import type { Revision } from "../../../lib/vault/revision-types";

export interface HealthInput {
  revision: Revision;
  counts: Health["counts"];
  /** Notes in the trash. */
  trash: number;
  /** Paths of the `(conflict …)` copies. */
  conflicts: string[];
  /** The preview's notes, for the index line. */
  indexed: number;
}

export function previewHealth({ revision, counts, trash, conflicts, indexed }: HealthInput): Health {
  return {
    revision,
    counts,
    index: { notes: indexed, unindexed: 0, schema: 0 },
    history: { on: false, pending: 0, lastCommit: null, busy: false },
    backup: { state: "off", lastPush: null, failures: 0, lastError: null },
    backupFile: null,
    proposals: 0,
    trash: { items: trash, bytes: 0 },
    conflicts,
    lastCheck: null,
    synced: null,
    format: 1,
  };
}

/** A copy a conflicting save made: `name (conflict 2026-10-11 09-30).md`. */
export const isConflictCopy = (path: string) => /\(conflict [^)]*\)(\.[^./]+)+$/.test(path);
