// Backup beyond the vault's own history, through the desktop app's commands
// (app/src-tauri/src/backup and git_host): Sign in with GitHub, a token for
// any git host, backup files in a sync or disk folder, Get latest and
// restoring into a new folder. The browser preview has none of these.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inDemo } from "../../demo/flag";
import { inTauri } from "../../lib/api";

/** What Get latest did. */
export interface Latest {
  outcome: "upToDate" | "fastForward" | "merged";
  head: string | null;
  /** Files that changed in this vault. */
  changed: string[];
  /** Copies of the other computer's versions kept beside this one's. */
  copies: string[];
  /** The other computer's settings set aside under `.kasten/conflicts/`. */
  setAside: string[];
}

/** What writing a backup file did. */
export interface BackupFile {
  path: string;
  head: string;
  /** False when the newest file already held everything. */
  written: boolean;
  bytes: number;
  removed: string[];
  kept: string[];
}

export interface GitHubAccount {
  login: string | null;
  signedIn: boolean;
  /** This build can sign in with GitHub, not only take a token. */
  canSignIn: boolean;
  /** A name for a new backup repository, from the vault's. */
  suggested: string | null;
}

export interface SignInCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export type SignInEnd =
  | { state: "signed"; login: string }
  | { state: "expired" }
  | { state: "denied" }
  | { state: "disabled" }
  | { state: "failed"; message: string };

export interface Repo {
  name: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  updatedAt: string | null;
}

/** Whether this window can back up beyond the vault: the desktop app, or the browser preview in demo mode. */
export const canBackUp = () => inTauri() || inDemo();

export const githubAccount = () => invoke<GitHubAccount>("github_account");
export const githubSignInStart = () => invoke<SignInCode>("github_sign_in_start");
export const githubSignInCancel = () => invoke<void>("github_sign_in_cancel");
/** Forgets the sign-in here; answers GitHub's page for taking access back. */
export const githubSignOut = () => invoke<string | null>("github_sign_out");
export const githubBackups = () => invoke<Repo[]>("github_backups");
export const githubCreateBackup = (name: string) => invoke<Repo>("github_create_backup", { name });

/** Calls `then` once a sign-in ends; returns how to stop listening. */
export function onSignIn(then: (end: SignInEnd) => void): () => void {
  const stop = listen<SignInEnd>("kasten://github-sign-in", (e) => then(e.payload));
  return () => void stop.then((fn) => fn(), () => {});
}

export const gitTokenSave = (url: string, secret: string, username?: string) =>
  invoke<{ remembered: boolean }>("git_token_save", { url, secret, username: username || null });
export const gitTokenForget = (url: string) => invoke<void>("git_token_forget", { url });

export const setBackupFolder = (folder: string | null) => invoke<void>("set_backup_folder", { folder });
export const backupFileNow = () => invoke<BackupFile>("backup_file_now");

export const getLatest = () => invoke<Latest>("get_latest");
export const getLatestFromFile = (path: string) => invoke<Latest>("get_latest_from_file", { path });
/** Whether the backup has changes this computer lacks; false when unsure. */
export const backupAhead = () => invoke<boolean>("backup_ahead");

/** Restores the backup at a git address into an empty folder, then Kasten
 * restarts on it. */
export const restoreFromGit = (url: string, path: string, secret?: string, username?: string) =>
  invoke<void>("restore_from_git", { url, path, secret: secret || null, username: username || null });
export const restoreFromFile = (file: string, path: string) => invoke<void>("restore_from_file", { file, path });
