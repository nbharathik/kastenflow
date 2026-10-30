// Step 4: the first backup. While it runs: what is left to send and how big
// the history is, read from the backup's status once a second or so. Then a
// summary in plain words with a way to open the repository.

import { useState } from "react";

import { openUrl } from "../../../lib/api";
import { useInterval } from "../../../lib/use-interval";
import type { BackupStatus } from "../../../lib/vault/backup-types";
import { Button } from "../../../ui/Button";
import { call } from "./api";
import { useBackupWizard, type Summary } from "./state";

const POLL_MS = 1200;

/** "12.4 MB", as people say it. */
export const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** What is going on, from the status: changes left to send, and the history's size. */
export function progressLine(status: BackupStatus | null): string {
  if (!status) return "Sending your notes…";
  const parts = [status.unpushed > 0 ? `${status.unpushed} ${status.unpushed === 1 ? "change" : "changes"} left to send` : "Sending your notes"];
  if (status.repoSize) parts.push(megabytes(status.repoSize));
  return parts.join(" · ");
}

function GitHubSummary({ summary }: { summary: Extract<Summary, { kind: "github" }> }) {
  const protection = summary.protection;
  const lock =
    protection?.state === "protected"
      ? "protection on"
      : `protection off${protection?.reason ? ` (${protection.reason})` : protection?.state === "unknown" ? " (could not be checked)" : ""}`;
  return (
    <>
      <p className="kasten-wiz-done">
        Backed up · {summary.visibility === "public" ? "public" : "private"} · {summary.fullName} · {lock}
      </p>
      <div className="kasten-wiz-row">
        <Button onClick={() => void openUrl(summary.htmlUrl)}>Open on GitHub</Button>
      </div>
    </>
  );
}

export function StepFirstBackup() {
  const { job, problem, summary, where, retry } = useBackupWizard();
  const [status, setStatus] = useState<BackupStatus | null>(null);

  useInterval(() => void call("backup_status").then(setStatus, () => {}), POLL_MS, job === "running");

  const { go } = useBackupWizard.getState();
  // "Both": GitHub is done, the folder comes next.
  const onward = () => go(where === "both" && summary?.kind === "github" ? "folder" : "next");

  return (
    <>
      {job === "running" && (
        <div role="status" className="kasten-wiz-stack">
          <progress className="kasten-wiz-progress" aria-label="Backing up" />
          <p className="kasten-wiz-note">{progressLine(status)}</p>
        </div>
      )}
      {job === "failed" && (
        <>
          <p role="alert" className="kasten-wiz-problem">
            {problem ?? "The backup did not finish."}
          </p>
          <div className="kasten-wiz-row">
            {retry && (
              <Button tone="primary" onClick={retry}>
                Try again
              </Button>
            )}
            <Button onClick={() => go("where")}>Back</Button>
          </div>
        </>
      )}
      {job === "done" && summary && (
        <>
          {summary.kind === "github" && <GitHubSummary summary={summary} />}
          {summary.kind === "host" && <p className="kasten-wiz-done">Backed up · {summary.remote}</p>}
          {summary.kind === "folder" && <p className="kasten-wiz-done">Backup file written · {summary.folder}</p>}
          <footer className="kasten-wiz-foot">
            <Button tone="primary" onClick={onward}>
              {where === "both" && summary.kind === "github" ? "Next: a folder" : "Next"}
            </Button>
          </footer>
        </>
      )}
    </>
  );
}
