// What the status popover says, as plain sentences, from the vault's status
// and the backup's richer one. Pure, so every state can be tested.

import { relativeTime } from "../../lib/dates";
import type { BackupStatus } from "../../lib/vault/backup-types";
import type { VaultStatus } from "../../lib/vault/types";

export interface Skipped {
  path: string;
  text: string;
}

export interface PopoverView {
  /** No backup is set up: the popover offers setup only. */
  off: boolean;
  /** "Backed up 2 min ago", or "Not backed up yet". */
  headline: string;
  /** "3 changes waiting", when some are. */
  waiting: string | null;
  /** "Verified 2 days ago", or null when it never was. */
  verified: string | null;
  /** Files left out, one line each, with the file to act on. */
  skipped: Skipped[];
  /** A red line: the repository is public and nobody said they want that. */
  publicRepo: boolean;
  /** The backup on GitHub lost history that this computer has. */
  lostHistory: boolean;
  /** The backup has failed for a while or refused pushes (the core's own judgement). */
  failing: string | null;
  /** The backup has changes this computer lacks. */
  behind: boolean;
  /** Safety branch the full history was saved to, when it was. */
  recovered: string | null;
  /** Where the backup lives, for "Open on GitHub". */
  remote: string | null;
}

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

export const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

export function popoverView(vault: VaultStatus | null, backup: BackupStatus | null, now = Date.now()): PopoverView {
  const state = vault?.backup.state ?? "off";
  const off = !vault || state === "off";
  const last = vault?.backup.lastPush ?? (backup?.lastBackupAt ? Date.parse(backup.lastBackupAt) : null);
  const waiting = backup && backup.unpushed > 0 ? `${changes(backup.unpushed)} waiting` : null;
  const verified = backup?.verifiedAt ? `Verified ${relativeTime(Date.parse(backup.verifiedAt), now)}` : null;
  const skipped = (backup?.skipped ?? []).map((f) => ({
    path: f.path,
    text: `Not backed up: ${f.path} is ${mb(f.size)}, over GitHub's 100 MB limit`,
  }));
  return {
    off,
    headline: off ? "Backup is off" : last ? `Backed up ${relativeTime(last, now)}` : "Not backed up yet",
    waiting,
    verified,
    skipped,
    publicRepo: backup?.visibility === "public" && backup.paused,
    lostHistory: backup?.lostHistory ?? false,
    failing: state === "failing" ? (vault?.backup.lastError ?? "Backing up has been failing for a while") : null,
    behind: vault?.backup.behind === true,
    recovered: backup?.recoveredBranch ?? null,
    remote: vault?.remote ?? backup?.repoUrl ?? null,
  };
}
