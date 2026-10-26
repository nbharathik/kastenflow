// The first backup, for each way of keeping notes safe. Each job runs from the
// store, not from a step's component, so closing the panel does not stop it.

import { backupFileNow, getLatest, gitTokenSave, setBackupFolder } from "../api";
import type { LinkOutcome, Protection, RepoRow } from "../../../lib/vault/backup-types";
import { useVaultStatus } from "../../workspace/status";
import { useWorkspace } from "../../workspace/store";
import { backupError, call, pushNow } from "./api";
import { useBackupWizard, type Verdict } from "./state";

const wizard = () => useBackupWizard.getState();

/** What a job came to: finished, or a repository held back for the person to decide on. */
type Outcome = "done" | { held: Verdict };

/** Runs a job on the "first backup" step. A name that is taken or a repository
 * held back sends the person back to the repository step, where the answer is. */
async function run(retry: () => void, work: () => Promise<Outcome>): Promise<void> {
  wizard().patch({ job: "running", problem: null, summary: null, verdict: null, taken: null, retry });
  wizard().go("first");
  try {
    const outcome = await work();
    if (outcome === "done") {
      // Nothing left to retry, and a retry closure may hold a token.
      wizard().patch({ job: "done", retry: null });
    } else {
      wizard().patch({ job: "idle", verdict: outcome.held });
      wizard().go("repo");
    }
  } catch (err) {
    const failure = backupError(err);
    if (failure.kind === "nameTaken" && failure.existing) {
      wizard().patch({ job: "idle", taken: failure.existing });
      wizard().go("repo");
    } else {
      wizard().patch({ job: "failed", problem: failure.message });
    }
  } finally {
    void useVaultStatus.getState().refresh();
  }
}

/** Makes a private repository and backs up into it (one command). */
export function createBackup(name: string): Promise<void> {
  return run(
    () => void createBackup(name),
    async () => {
      const made = await call("github_create_backup", { name });
      wizard().patch({ summary: { kind: "github", fullName: made.fullName, htmlUrl: made.htmlUrl, visibility: made.visibility, protection: made.protection } });
      return "done";
    },
  );
}

/** Uses a repository that exists: a public one is held back, an unrelated one
 * refused, one with this vault's history gets the latest first. */
export function linkBackup(repo: RepoRow, protection: Protection | null): Promise<void> {
  return run(
    () => void linkBackup(repo, protection),
    async () => {
      let outcome: LinkOutcome;
      try {
        outcome = await call("backup_link_existing", { url: repo.cloneUrl });
      } catch (err) {
        if (backupError(err).kind === "publicRepo") return { held: { kind: "public", repo: { ...repo, visibility: "public" }, protection } };
        throw err;
      }
      if (outcome.result === "refused") return { held: { kind: "refused", repo, choices: outcome.choices } };
      if (outcome.behind) await getLatest();
      await pushNow();
      wizard().patch({ summary: { kind: "github", fullName: repo.fullName, htmlUrl: repo.htmlUrl, visibility: repo.visibility, protection } });
      return "done";
    },
  );
}

/** Another git host: the address (and a token for an https one), then a push. */
export function backUpToHost(remote: string, username: string, token: string): Promise<void> {
  return run(
    () => void backUpToHost(remote, username, token),
    async () => {
      const client = useWorkspace.getState().client;
      if (!client) throw new Error("No vault is open");
      const config = await client.getConfig();
      await client.setConfig({ ...config, git: { ...config.git, remote } });
      if (token.trim()) {
        await gitTokenSave(remote, token.trim(), username.trim() || undefined);
        // The keychain has it now: a retry needs no copy of the token in memory.
        wizard().patch({ retry: () => void backUpToHost(remote, username, "") });
      }
      await pushNow();
      wizard().patch({ summary: { kind: "host", remote } });
      return "done";
    },
  );
}

/** Backup files in a folder (a sync folder or a disk), the first one written now. */
export function backUpToFolder(folder: string): Promise<void> {
  return run(
    () => void backUpToFolder(folder),
    async () => {
      await setBackupFolder(folder);
      await backupFileNow();
      wizard().patch({ summary: { kind: "folder", folder } });
      return "done";
    },
  );
}
