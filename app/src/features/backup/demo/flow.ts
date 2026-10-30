// The demo's backup, as a small state machine: signed out, signed in, a private
// repository made and the first backup sent, then backed up. The desktop app's
// commands answer from this; the real screens (the status bar, the guided
// panel, Settings, History) draw it. Nothing here is saved or sent anywhere.

import type { BackUpNow, BackupStatus, CreatedBackup } from "../../../lib/vault/backup-types";
import type { BackupFileStatus, BackupStatus as VaultBackup } from "../../../lib/vault/status-types";
import type { DemoClock } from "../../../demo/clock";
import type { BackupFile, GitHubAccount, Latest, SignInCode, SignInEnd } from "../api";

export const DEMO_LOGIN = "maya-notes";
export const DEMO_REPO = "kastenflow-vault";
export const DEMO_CODE = "WDJB-MJHT";
/** How long the sign-in waits for the (pretend) approval on GitHub. */
export const SIGN_IN_MS = 2000;
/** How long the first backup runs, with its bar. */
export const FIRST_BACKUP_MS = 3000;
/** Changes the first backup sends. */
const FIRST_CHANGES = 48;
const SIZE = 1_468_006;

/** Where the status bar starts: no backup, or a backup that never happened, or a finished one. */
export type Preset = "off" | "notBackedUp" | "backedUp";

type Emit = (event: string, payload: unknown) => void;

/** The next answer of Get latest. */
export type LatestKind = "upToDate" | "changes";

export class BackupFlow {
  signedIn = false;
  remote: string | null = null;
  lastPush: number | null = null;
  /** The status bar shows an amber "Not backed up yet" without any repository. */
  unbacked = false;
  waiting = 0;
  /** The folder backup files go to, and when the newest was written. */
  folder: string | null = null;
  fileWritten: number | null = null;
  private stopSignIn: (() => void) | null = null;
  private creating: { started: number } | null = null;
  private latests: LatestKind[] = ["changes"];
  private signedLogin: string | null = null;

  constructor(
    private readonly clock: DemoClock,
    private readonly emit: Emit,
  ) {}

  /** Back to where a recording starts. */
  reset(): void {
    this.stopSignIn?.();
    this.stopSignIn = null;
    this.signedIn = false;
    this.signedLogin = null;
    this.remote = null;
    this.lastPush = null;
    this.unbacked = false;
    this.waiting = 0;
    this.folder = null;
    this.fileWritten = null;
    this.creating = null;
    this.latests = ["changes"];
  }

  /** Jumps to a starting point for a scene. */
  preset(name: Preset): void {
    this.reset();
    if (name === "notBackedUp") this.unbacked = true;
    if (name === "backedUp") this.finish();
  }

  /** The last backup finished `minutes` ago. */
  ageMinutes(minutes: number): void {
    if (this.lastPush !== null) this.lastPush = this.clock.now() - minutes * 60_000;
  }

  /** The answers of the next Get latest, in order; after them it is up to date. */
  queueLatest(...next: LatestKind[]): void {
    this.latests = next;
  }

  account(): GitHubAccount {
    return { login: this.signedIn ? DEMO_LOGIN : null, signedIn: this.signedIn, canSignIn: true, suggested: DEMO_REPO };
  }

  startSignIn(): SignInCode {
    this.stopSignIn?.();
    this.stopSignIn = this.clock.after(SIGN_IN_MS, () => {
      this.stopSignIn = null;
      this.signedIn = true;
      this.signedLogin = DEMO_LOGIN;
      this.emit("kasten://github-sign-in", { state: "signed", login: DEMO_LOGIN } satisfies SignInEnd);
    });
    return { userCode: DEMO_CODE, verificationUri: "https://github.com/login/device", expiresIn: 900 };
  }

  /** Only a sign-in still waiting ends; one that was approved stays. */
  cancelSignIn(): void {
    this.stopSignIn?.();
    this.stopSignIn = null;
  }

  signOut(): string | null {
    this.cancelSignIn();
    this.signedIn = false;
    this.signedLogin = null;
    return "https://github.com/settings/connections/applications/kastenflow";
  }

  /** Makes the private repository and sends the first backup; answers when the bar is full. */
  createBackup(name: string): Promise<CreatedBackup> {
    this.creating = { started: this.clock.now() };
    const repo = name.trim() || DEMO_REPO;
    return new Promise((resolve) => {
      this.clock.after(FIRST_BACKUP_MS, () => {
        this.remote = `https://github.com/${this.signedLogin ?? DEMO_LOGIN}/${repo}.git`;
        this.finish();
        resolve({
          name: repo,
          fullName: `${this.signedLogin ?? DEMO_LOGIN}/${repo}`,
          cloneUrl: this.remote,
          htmlUrl: `https://github.com/${this.signedLogin ?? DEMO_LOGIN}/${repo}`,
          updatedAt: new Date(this.clock.now()).toISOString(),
          visibility: "private",
          isBackup: true,
          protection: { state: "protected", reason: null },
        });
      });
    });
  }

  /** A finished backup: the repository is there and the last backup is now. */
  private finish(): void {
    this.creating = null;
    this.unbacked = false;
    this.waiting = 0;
    this.signedIn = true;
    this.signedLogin ??= DEMO_LOGIN;
    this.remote ??= `https://github.com/${DEMO_LOGIN}/${DEMO_REPO}.git`;
    this.lastPush = this.clock.now();
  }

  backupNow(): BackUpNow {
    if (this.remote === null) return { answer: "not", reason: { kind: "noBackup" } };
    if (this.waiting === 0) return { answer: "nothingToDo" };
    const sent = this.waiting;
    this.waiting = 0;
    this.lastPush = this.clock.now();
    return { answer: "done", sent };
  }

  /** The vault status's backup part, as the status bar reads it. */
  vaultBackup(): VaultBackup {
    if (this.remote !== null) return { state: "ok", lastPush: this.lastPush, failures: 0, lastError: null };
    if (this.unbacked) return { state: "stale", lastPush: null, failures: 0, lastError: null };
    return { state: "off", lastPush: null, failures: 0, lastError: null };
  }

  /** "Back up there" and the wizard's push: sends what waits. */
  pushNow(): VaultBackup {
    this.backupNow();
    return this.vaultBackup();
  }

  /** The richer status: what is left to send while the first backup runs, then the finished one. */
  status(): BackupStatus {
    const now = this.clock.now();
    let unpushed = this.waiting;
    if (this.creating) {
      const share = Math.min(1, (now - this.creating.started) / FIRST_BACKUP_MS);
      unpushed = Math.max(1, Math.ceil(FIRST_CHANGES * (1 - share)));
    }
    const done = this.lastPush !== null;
    return {
      waiting: unpushed > 0,
      unpushed,
      verifiedAt: done ? new Date(this.lastPush!).toISOString() : null,
      skipped: [],
      warn: [],
      visibility: "private",
      paused: false,
      protection: { state: "protected", reason: null },
      lostHistory: false,
      recoveredBranch: null,
      lastBackupAt: done ? new Date(this.lastPush!).toISOString() : null,
      repoSize: this.creating || done ? SIZE : null,
      repoUrl: this.remote ? this.remote.replace(/\.git$/, "") : null,
    };
  }

  /** Get latest: the first time two files come in, then it is up to date. */
  latest(): Latest {
    const next = this.latests.shift() ?? "upToDate";
    if (next === "upToDate") return { outcome: "upToDate", head: "a41c9e2", changed: [], copies: [], setAside: [] };
    return { outcome: "fastForward", head: "b7d03f1", changed: ["library/launch-checklist.md", "library/reading-list.md"], copies: [], setAside: [] };
  }

  /** Backup files go to `folder` from now on, or stop (null). */
  setFolder(folder: string | null): void {
    this.folder = folder;
    if (folder === null) this.fileWritten = null;
  }

  /** A backup file in the chosen folder: written at once. */
  file(): BackupFile {
    this.fileWritten = this.clock.now();
    return { path: `${this.folder ?? "Backups"}/kastenflow-vault.bundle`, head: "a41c9e2", written: true, bytes: SIZE, removed: [], kept: [] };
  }

  /** The vault status's part about backup files. */
  vaultFile(): { backupFolder: string | null; backupFile: BackupFileStatus | null } {
    if (this.folder === null) return { backupFolder: null, backupFile: null };
    const written = this.fileWritten;
    return { backupFolder: this.folder, backupFile: { state: written === null ? "unconfirmed" : "ok", lastWritten: written, path: this.folder, current: written !== null, failures: 0, lastError: null } };
  }
}
