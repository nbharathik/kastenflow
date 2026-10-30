// A pretend desktop backend for the wizard's tests: the commands the wizard
// calls, answered from a table a test can change, and every call recorded.
// The tests mock "@tauri-apps/api/core" to call `answer` (the Tauri boundary).

import type { BackupStatus, RepoCheck, RepoRow } from "../../../lib/vault/backup-types";

export type Handler = (args: Record<string, unknown>) => unknown;

export const bk = {
  handlers: {} as Record<string, Handler>,
  calls: [] as [string, Record<string, unknown>][],
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
};

export async function answer(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  bk.calls.push([cmd, args]);
  const handler = bk.handlers[cmd];
  if (!handler) throw { kind: "other", message: `no answer for ${cmd}` };
  return handler(args);
}

export const called = (cmd: string) => bk.calls.filter(([name]) => name === cmd);
export const order = (...cmds: string[]) => cmds.map((cmd) => bk.calls.findIndex(([name]) => name === cmd));

export const row = (fullName: string, extra: Partial<RepoRow> = {}): RepoRow => ({
  name: fullName.split("/")[1]!,
  fullName,
  cloneUrl: `https://github.com/${fullName}.git`,
  htmlUrl: `https://github.com/${fullName}`,
  updatedAt: "2026-10-01T10:00:00Z",
  visibility: "private",
  isBackup: false,
  ...extra,
});

export const check = (extra: Partial<RepoCheck> = {}): RepoCheck => ({
  exists: true,
  visibility: "private",
  protection: { state: "protected", reason: null },
  empty: false,
  content: "thisVault",
  ...extra,
});

export const status = (extra: Partial<BackupStatus> = {}): BackupStatus => ({
  waiting: false,
  unpushed: 0,
  verifiedAt: null,
  skipped: [],
  warn: [],
  visibility: "private",
  paused: false,
  protection: { state: "protected", reason: null },
  lostHistory: false,
  recoveredBranch: null,
  lastBackupAt: null,
  repoSize: null,
  repoUrl: null,
  ...extra,
});

/** The sign-in code event the desktop app sends. */
export const signInEnds = (payload: unknown) => bk.listeners.get("kasten://github-sign-in")?.({ payload });

/** The everyday answers: signed out, a free name, an empty list of repositories. */
export function reset(overrides: Record<string, Handler> = {}): void {
  bk.calls.length = 0;
  bk.listeners.clear();
  bk.handlers = {
    github_account: () => ({ login: null, signedIn: false, canSignIn: true, suggested: "my-notes" }),
    github_sign_in_start: () => ({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900 }),
    github_sign_in_cancel: () => null,
    github_gh_cli_available: () => false,
    github_token_page: () => "https://github.com/settings/personal-access-tokens/new?name=KastenFlow+backup",
    github_token_sign_in: () => ({ login: "ada", repo: null, remembered: true }),
    github_gh_cli_sign_in: () => ({ login: "ada", repo: null, remembered: true }),
    github_name_available: () => true,
    github_create_backup: ({ name }) => ({ ...row(`ada/${name}`), protection: { state: "protected", reason: null } }),
    github_repos: () => ({ repos: [], hasMore: false }),
    github_repo_check: () => check(),
    github_make_private: () => "private",
    github_allow_public: () => null,
    backup_link_existing: () => ({ result: "linked", empty: false, behind: false, status: status() }),
    backup_status: () => status(),
    get_latest: () => ({ outcome: "upToDate", head: "abc", changed: [], copies: [], setAside: [] }),
    push_now: () => ({ state: "ok", lastPush: 1, failures: 0, lastError: null }),
    open_url: () => null,
    browse_folders: () => ({ path: "C:\\Users", parent: null, folders: [], places: [] }),
    ...overrides,
  };
}
