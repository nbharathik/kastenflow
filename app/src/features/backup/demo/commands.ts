// The desktop app's backup commands, answered from the demo's flow. Only the
// ones the real screens ask while someone signs in, makes the first backup,
// backs up, gets the latest or looks at Settings are here.

import type { Handler } from "../../../demo/ipc";
import { listing } from "./browse";
import type { BackupFlow } from "./flow";
import { DEMO_REPO } from "./flow";

export function backupCommands(flow: BackupFlow): Record<string, Handler> {
  return {
    github_account: () => flow.account(),
    github_sign_in_start: () => flow.startSignIn(),
    github_sign_in_cancel: () => flow.cancelSignIn(),
    github_sign_out: () => flow.signOut(),
    github_backups: () => [],
    github_repos: () => ({ repos: [], hasMore: false }),
    github_name_available: () => true,
    github_gh_cli_available: () => false,
    github_create_backup: (args) => flow.createBackup(String(args.name ?? DEMO_REPO)),
    github_revoke_link: () => ({ url: "https://github.com/settings/connections/applications/kastenflow", sessionOnly: false }),
    backup_status: () => flow.status(),
    backup_now: () => flow.backupNow(),
    push_now: () => flow.pushNow(),
    backup_look_due: () => ({ due: false, canTakeIn: false }),
    backup_look: () => ({ result: "upToDate" }),
    backup_ahead: () => false,
    get_latest: () => flow.latest(),
    get_latest_from_file: () => flow.latest(),
    set_backup_folder: (args) => flow.setFolder(typeof args.folder === "string" ? args.folder : null),
    backup_file_now: () => flow.file(),
    browse_folders: (args) => listing(typeof args.path === "string" ? args.path : null),
    git_token_save: () => ({ remembered: true }),
    git_token_forget: () => undefined,
  };
}
