// The backup command contract: these types mirror, field for field, the
// Rust types in app/src-tauri/src/backup/contract.rs (camelCase). A command
// that fails answers a `BackupError`: a `kind` and one plain sentence in
// `message`, with no token in it.

export type Visibility = "private" | "public" | "unknown";
export type ProtectionState = "protected" | "unprotected" | "unknown";

export interface Protection {
  state: ProtectionState;
  /** One plain sentence on why, when it is not protected or not known. */
  reason: string | null;
}

/** A file left out of the backup, for example for its size. */
export interface SkippedFile {
  path: string;
  size: number;
  /** When it was first left out (ISO time). */
  since: string;
}

/** A file that is backed up but large enough for GitHub to warn about. */
export interface LargeFile {
  path: string;
  size: number;
}

export interface BackupStatus {
  /** Changes are waiting to go to the backup. */
  waiting: boolean;
  /** How many changes are waiting. */
  unpushed: number;
  /** When the backup was last read back and found to match (ISO time). */
  verifiedAt: string | null;
  skipped: SkippedFile[];
  /** Files backed up that GitHub warns about for their size. */
  warn: LargeFile[];
  visibility: Visibility;
  /** Pushing is paused: the repository is public and nobody said they want that. */
  paused: boolean;
  protection: Protection;
  /** The backup lost history that this computer still has. */
  lostHistory: boolean;
  /** The safety branch this computer's full history was last saved to. */
  recoveredBranch: string | null;
  /** When the last backup finished (ISO time). */
  lastBackupAt: string | null;
  /** What the history takes on this computer, in bytes, when known. */
  repoSize: number | null;
  repoUrl: string | null;
}

export interface RepoRow {
  name: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  updatedAt: string | null;
  visibility: Visibility;
  /** A repository KastenFlow made for a backup (listed first). */
  isBackup: boolean;
}

export interface RepoPage {
  repos: RepoRow[];
  hasMore: boolean;
}

/** What a repository holds, next to this vault's history. */
export type RepoContent = "empty" | "thisVault" | "unrelated" | "unknown";

export interface RepoCheck {
  /** False when GitHub shows nothing by that name to this sign-in. */
  exists: boolean;
  visibility: Visibility;
  protection: Protection;
  /** Nothing has been pushed to it yet. */
  empty: boolean;
  content: RepoContent;
}

export interface SignedIn {
  login: string;
  /** The repository chosen along with the sign-in, if one was given. */
  repo: RepoRow | null;
  /** Kept in the keychain; false: the sign-in lasts only until KastenFlow closes. */
  remembered: boolean;
}

/** The page where GitHub lets the person take access back for good. */
export interface RevokeLink {
  url: string;
  /** The sign-in is not in the keychain, so it ends when KastenFlow closes. */
  sessionOnly: boolean;
}

/** A repository made for the backup, with the lock on its branch. */
export interface CreatedBackup extends RepoRow {
  protection: Protection;
}

export type LinkChoice = "pickAnother" | "createNew" | "restoreIntoNewFolder";

/** What linking a vault to an existing backup came to. */
export type LinkOutcome =
  | { result: "linked"; empty: boolean; behind: boolean; status: BackupStatus }
  | { result: "refused"; choices: LinkChoice[] };

/** What carrying on with a rewritten backup found. */
export interface CarryOn {
  tip: string | null;
  /** False: this computer's history and the backup's share nothing. */
  canPush: boolean;
}

/** Why a backup command did not run; every kind carries one plain sentence. */
export type BackupError =
  | { kind: "signedOut"; message: string }
  | { kind: "noAccess"; message: string }
  | { kind: "cannotWrite"; message: string }
  | { kind: "notFound"; message: string }
  /** `resetsAt`: milliseconds since the Unix epoch, when known. */
  | { kind: "rateLimited"; message: string; resetsAt: number | null }
  /** `existing`: the repository by that name, to use instead. */
  | { kind: "nameTaken"; message: string; existing: RepoRow | null }
  /** The repository is public and nobody said they want that. */
  | { kind: "publicRepo"; message: string; repo: string }
  | { kind: "noGhCli"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "other"; message: string };

/** What "Back up now" answered: always one of these. */
export type BackUpNow =
  | { answer: "done"; sent: number }
  | { answer: "nothingToDo" }
  | { answer: "not"; reason: NotBackedUp };

export type NotBackedUp =
  | { kind: "noHistory" }
  | { kind: "noBackup" }
  | { kind: "notConfirmed" }
  | { kind: "lostHistory" }
  | { kind: "behind" }
  | { kind: "failed"; message: string };

export type HeldWhy = "noBackup" | "manual" | "lostHistory" | "unfinished" | "unsavedEdits" | "waitingHere" | "unrelated";

/** What a look at the backup for other computers' changes did. */
export type AutoPull =
  | { result: "held"; why: HeldWhy }
  | { result: "upToDate" }
  | { result: "brought"; changes: number; files: number; head: string }
  | { result: "available"; merge: boolean };

export interface LookDue {
  due: boolean;
  canTakeIn: boolean;
}

/** Command names and their arguments and answers, for the backup section. */
export interface BackupCommands {
  backup_now: { args: Record<string, never>; result: BackUpNow };
  backup_look_due: { args: { unsavedEdits: boolean }; result: LookDue };
  backup_look: { args: { unsavedEdits: boolean }; result: AutoPull };
  backup_status: { args: Record<string, never>; result: BackupStatus };
  backup_link_existing: { args: { url: string }; result: LinkOutcome };
  /** Saves this computer's full history to a safety branch; answers its name. */
  backup_save_full_history: { args: Record<string, never>; result: string };
  /** Carries on with the backup as it is now, after it was rewritten. */
  backup_carry_on: { args: Record<string, never>; result: CarryOn };
  github_repos: { args: { query: string; page: number }; result: RepoPage };
  github_repo_check: { args: { repo: string }; result: RepoCheck };
  github_repo_visibility: { args: { repo: string }; result: Visibility };
  github_make_private: { args: { repo: string }; result: Visibility };
  /** Says the person wants this repository as a public backup. */
  github_allow_public: { args: { repo: string }; result: null };
  github_name_available: { args: { name: string }; result: boolean };
  /** GitHub's page for making a fine-grained token, filled in. */
  github_token_page: { args: Record<string, never>; result: string };
  github_token_sign_in: { args: { token: string; repo?: string | null }; result: SignedIn };
  github_gh_cli_available: { args: Record<string, never>; result: boolean };
  github_gh_cli_sign_in: { args: Record<string, never>; result: SignedIn };
  github_revoke_link: { args: Record<string, never>; result: RevokeLink };
  github_create_backup: { args: { name: string }; result: CreatedBackup };
  github_backups: { args: Record<string, never>; result: RepoRow[] };
}
