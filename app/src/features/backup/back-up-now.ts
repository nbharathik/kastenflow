// "Back up now": it always answers, one plain sentence whichever way it went
// (done, nothing to do, or the reason). Also opening the backup on GitHub.

import { invoke } from "@tauri-apps/api/core";

import { openUrl } from "../../lib/api";
import type { BackUpNow, NotBackedUp } from "../../lib/vault/backup-types";
import { writeEverything } from "../workspace/page/before-exit";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { message } from "./parts";
import { useBackupStatus } from "./use-backup-status";

const plural = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

function reason(why: NotBackedUp): string {
  switch (why.kind) {
    case "noHistory":
      return "History is off, so there is nothing to back up. Turn history on in Settings first.";
    case "noBackup":
      return "No backup is set up yet.";
    case "notConfirmed":
      return "This computer has not checked the backup this vault points to yet. Open Backup in Settings to check it.";
    case "lostHistory":
      return "The backup on GitHub is missing some of your history, so nothing was sent. Save this computer's full history as a separate copy on GitHub first.";
    case "behind":
      return "The backup has changes from another computer. Get the latest first, then back up.";
    case "failed":
      return why.message;
  }
}

/** The answer in one plain sentence. */
export function sayBackUpNow(answer: BackUpNow): string {
  switch (answer.answer) {
    case "done":
      return `Backed up: ${plural(answer.sent)} sent.`;
    case "nothingToDo":
      return "Nothing to back up: the backup already has every change.";
    case "not":
      return reason(answer.reason);
  }
}

/** Writes what is typed, backs up, and says how it went. Answers the answer, or null on an error. */
export async function runBackUpNow(): Promise<BackUpNow | null> {
  const { toast } = useWorkspace.getState();
  try {
    await writeEverything();
    const answer = await invoke<BackUpNow>("backup_now");
    const set = answer.answer === "not" && answer.reason.kind === "noBackup";
    toast(sayBackUpNow(answer), set ? { label: "Set up backup", run: () => void import("./open-wizard").then((m) => m.openWizard()) } : undefined);
    return answer;
  } catch (err) {
    toast(message(err));
    return null;
  } finally {
    void useVaultStatus.getState().refresh();
    void useBackupStatus.getState().refresh();
  }
}

/** The web page of a repository from its clone address, or null for any other host. */
export function githubPage(remote: string | null): string | null {
  const found = remote?.trim().match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  return found ? `https://github.com/${found[1]}` : null;
}

/** Opens the backup on GitHub in the browser; says why when it is not on GitHub. */
export function openBackupOnGitHub(remote: string | null): void {
  const page = githubPage(remote);
  if (page) void openUrl(page);
  else useWorkspace.getState().toast("This backup is not on GitHub");
}
