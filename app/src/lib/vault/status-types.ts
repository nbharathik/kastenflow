// The vault's history, backup, settings and check as the frontend sees them
// (serde, camelCase). `types.ts` re-exports all of them.

/** What restoring the whole vault did. */
export interface VaultRestore {
  /** Files written back to their old text. */
  written: string[];
  /** Where files made after the point went, under `.trash/`. */
  trashed: string[];
  /** The commit the restore made, which undo takes back whole. */
  commit: string | null;
}

export interface CommitInfo {
  id: string;
  summary: string;
  message: string;
  author: string;
  /** Milliseconds since the Unix epoch. */
  time: number;
  agent: boolean;
  session: string | null;
  op: string | null;
  /** Who accepted the agent's proposal. */
  approvedBy: string | null;
  /** The commit this one undoes. */
  undoes: string | null;
  /** It joins two lines of history, as getting the latest does; it can't
   * be undone as one change. */
  merge?: boolean;
}

/** `unconfirmed`: the vault names a remote no one confirmed on this
 * computer, so nothing is pushed there yet. */
export type BackupState = "off" | "ok" | "stale" | "failing" | "unconfirmed";

export interface BackupStatus {
  state: BackupState;
  lastPush: number | null;
  failures: number;
  lastError: string | null;
  /** The last push was refused because the backup has changes this
   * computer lacks: get the latest first. */
  behind?: boolean;
}

/** How the backup files in a sync or disk folder stand. */
export interface BackupFileStatus {
  state: BackupState;
  lastWritten: number | null;
  path: string | null;
  /** The newest file holds every commit there is now. */
  current: boolean;
  failures: number;
  lastError: string | null;
}

export interface VaultStatus {
  name: string;
  root: string;
  /** Whether the vault keeps git history. */
  history: boolean;
  remote: string | null;
  backup: BackupStatus;
  /** Edits waiting for their commit. */
  pending: number;
  /** The folder backup files go to on this computer (desktop only). */
  backupFolder?: string | null;
  backupFile?: BackupFileStatus | null;
  /** This computer's name, which its backup files carry. */
  computer?: string;
  /** A Get latest stopped part way and waits to be finished. */
  unfinished?: boolean;
  /** The sync app whose folder holds the vault (OneDrive, Dropbox…), if any. */
  synced?: string | null;
}

/** What emptying the trash did; undoing `commit` brings it all back. */
export interface Emptied {
  removed: number;
  /** Files kept because history does not hold them as they are. */
  kept: string[];
  commit: string | null;
}

/** `.kasten/config.yaml`, as the core reads it. */
export interface VaultConfig {
  name: string;
  git: { remote: string | null; push_delay_seconds: number; push_interval_minutes: number };
  guardrails: Record<string, number>;
  ai: {
    providers: { name: string; kind: string; base_url: string; model: string }[];
    /** Search by meaning: the provider and model that make notes' vectors. */
    embeddings?: { provider: string; model: string } | null;
  };
  /** The template new journal days start from, by name; none means "journal". */
  journal_template?: string | null;
}

export interface Problem {
  kind: string;
  path: string | null;
  detail: string;
}

export interface VerifyReport {
  notes: number;
  boards: number;
  decks: number;
  gitObjects: number;
  problems: Problem[];
}
