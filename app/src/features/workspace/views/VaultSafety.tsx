import { useEffect, useState } from "react";

import { inDemo } from "../../../demo/flag";
import { canBackUp } from "../../backup/api";
import { BackupFileRow } from "../../backup/BackupFileRow";
import { GitHubRow } from "../../backup/GitHubRow";
import { LatestRow } from "../../backup/LatestRow";
import { useHealth } from "../../health/health-store";
import type { RowComponent } from "../../backup/parts";
import { PreviewBackup } from "../../backup/PreviewBackup";
import { RemoteRow } from "../../backup/RemoteRow";
import { syncedWords } from "../../vaults/SyncedNote";
import { useVaultStatus } from "../status";
import { useWorkspace } from "../store";

const button = "ui-btn";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** History, backup somewhere else (GitHub, any git host, or backup files
 * in a sync folder), Get latest, and the integrity check. */
export function VaultSafety({ Row, part = "all" }: { Row: RowComponent; part?: "all" | "history" | "backup" }) {
  const client = useWorkspace((s) => s.client);
  const status = useVaultStatus((s) => s.status);
  const [busy, setBusy] = useState<string | null>(null);
  // The check's answer is kept where the health page reads it too.
  const report = useHealth((s) => s.report);
  const { toast, openPath } = useWorkspace.getState();

  useEffect(() => {
    if (client) void useVaultStatus.getState().refresh();
  }, [client]);

  if (!client) return null;
  const run = async (what: string, job: () => Promise<void>) => {
    setBusy(what);
    try {
      await job();
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(null);
      void useVaultStatus.getState().refresh();
    }
  };
  // The demo (`?demo=1.2.2`) shows the real backup rows over its own pretend account.
  const preview = client.kind === "preview" && !inDemo();
  const history = part !== "backup";
  const backup = part !== "history";

  return (
    <>
      {history && status?.synced && (
        <Row
          label="Vault folder"
          detail={`This vault is ${syncedWords(status.synced)} Quit KastenFlow, move the vault folder out of it, then open the folder from its new place. Backup below keeps a copy in the cloud instead.`}
        >
          <span role="status" className="text-13 text-warning">
            In {status.synced}
          </span>
        </Row>
      )}
      {history && (
        <Row
          label="History"
          detail={
            status?.history
              ? "Saved changes are recorded in local Git history so you can restore earlier versions."
              : "Record saved changes in local Git history to help recover earlier versions."
          }
        >
          {status?.history ? (
            <span className="text-13 text-success">On</span>
          ) : (
            <button type="button" className={button} disabled={busy !== null} onClick={() => void run("history", async () => {
              await client.startHistory();
              toast("History is on: every change is now kept");
            })}>
              Turn on
            </button>
          )}
        </Row>
      )}
      {backup &&
        (preview ? (
          <PreviewBackup Row={Row} />
        ) : (
          <>
            {canBackUp() && <GitHubRow Row={Row} />}
            <RemoteRow Row={Row} />
            <LatestRow Row={Row} />
            {canBackUp() && <BackupFileRow Row={Row} />}
          </>
        ))}
      {history && (
      <Row label="Check the vault" detail="Looks for pages with broken properties, pages that clash with each other, links to missing pages and damaged history.">
        <button type="button" className={button} disabled={busy !== null} onClick={() => void run("verify", async () => void (await useHealth.getState().check()))}>
          {busy === "verify" ? "Checking…" : "Check now"}
        </button>
      </Row>
      )}
      {history && report && (
        <div className="py-3 text-13" role="status">
          {report.problems.length === 0 ? (
            <p className="text-success">All {report.notes} notes look fine.</p>
          ) : (
            <>
              <p>
                {report.problems.length} {report.problems.length === 1 ? "thing" : "things"} to look at in {report.notes} notes:
              </p>
              <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
                {report.problems.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 rounded bg-line/60 px-1.5 text-12 leading-5 text-muted">{p.kind}</span>
                    {p.path ? (
                      <button type="button" className="truncate text-left hover:underline" onClick={() => openPath(p.path!)}>
                        {p.path}
                      </button>
                    ) : null}
                    <span className="text-muted">{p.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
