// Health: one read-only report on the vault (its files, index, history,
// backup, proposals and trash; the shapes of kasten-core's health op, serde
// camelCase) and the call the app makes. The desktop app adds what only it
// knows: the backup folder, search by meaning and its own version.

import type { DraftRule } from "./draft-rule";
import type { Revision } from "./revision-types";
import type { BackupFileStatus, BackupStatus } from "./types";

/** How many of each kind of file the vault holds. */
export interface HealthCounts {
  notes: number;
  boards: number;
  decks: number;
  diagrams: number;
  /** PDFs in `sources/`. */
  sources: number;
  /** Files in `assets/`. */
  assets: number;
}

/** The last `verify`, which the core keeps in its cache folder. */
export interface LastCheck {
  /** Milliseconds since the Unix epoch. */
  time: number;
  notes: number;
  boards: number;
  decks: number;
  problems: number;
}

/** Search by meaning, as the desktop app reports it. */
export interface MeaningHealth {
  provider: string | null;
  model: string | null;
  done: number;
  total: number;
  running: boolean;
}

export interface Health {
  /** The change counters now. */
  revision: Revision;
  counts: HealthCounts;
  index: {
    /** Notes the index holds. */
    notes: number;
    /** Files an op wrote that the index could not take yet. */
    unindexed: number;
    /** The index's schema version. */
    schema: number;
  };
  history: {
    on: boolean;
    /** Edits waiting for their commit. */
    pending: number;
    /** Milliseconds since the Unix epoch; null before this session's first commit. */
    lastCommit: number | null;
    /** A git command run by hand is at work: writes wait until it ends. */
    busy: boolean;
  };
  backup: BackupStatus;
  backupFile: BackupFileStatus | null;
  /** Proposals waiting for review. */
  proposals: number;
  trash: { items: number; bytes: number };
  /** `(conflict …)` copies the vault holds, by path. */
  conflicts: string[];
  lastCheck: LastCheck | null;
  /** The sync app whose folder holds the vault (OneDrive, Dropbox…), if any. */
  synced: string | null;
  /** The vault's format version. */
  format: number;
  /** The folder backup files go to on this computer (desktop only). */
  backupFolder?: string | null;
  meaning?: MeaningHealth | null;
  appVersion?: string;
}

export interface HealthOps {
  /** Looks at the vault and changes nothing. */
  vaultHealth(): Promise<Health>;
}

/** What a call about a draft does, for each call of `HealthOps`. */
export const HEALTH_RULES = {
  vaultHealth: "pass",
} as const satisfies Record<keyof HealthOps, DraftRule>;
