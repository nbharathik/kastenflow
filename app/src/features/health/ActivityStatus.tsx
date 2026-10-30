// The status area's one indicator: Saved, Saving, Indexing, External changes,
// Proposed, Stale or Failed (activity.ts says which). Beside "Saved" it keeps
// saying how fresh the backup is, as the backup dot did. A click goes to what
// needs a look: Review for proposals, otherwise the health page in Settings.

import { useEffect, useMemo } from "react";

import { useShell } from "../../lib/store";
import { useInterval } from "../../lib/use-interval";
import { describeBackup, useVaultStatus } from "../workspace/status";
import { useStamp } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";
import { openSettingsAt } from "../workspace/views/settings/jump";
import { activityOf, type ActivityState } from "./activity";
import { useHealth } from "./health-store";

/** The health report is read again this long after the last change to the vault, and on this beat. */
const SETTLE_MS = 400;
const POLL_MS = 30_000;

const DOT: Record<ActivityState, string> = {
  saved: "bg-success",
  saving: "animate-pulse bg-warning",
  indexing: "animate-pulse bg-warning",
  external: "bg-warning",
  proposed: "bg-warning",
  stale: "bg-warning",
  failed: "bg-danger",
};

export function ActivityStatus() {
  const client = useWorkspace((s) => s.client);
  const saves = useShell((s) => s.saveStates);
  const commitError = useVaultStatus((s) => s.error);
  const status = useVaultStatus((s) => s.status);
  const health = useHealth((s) => s.health);
  const stamp = useStamp("notes", "boards", "decks");

  // Read after a change to the vault has settled, after a commit, and on a slow beat for what happens outside (proposals, copies).
  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void useHealth.getState().refresh(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [client, stamp, status?.pending, commitError]);
  useInterval(() => void useHealth.getState().refresh(), POLL_MS, Boolean(client));

  const activity = useMemo(() => activityOf({ saves, commitError, health }), [saves, commitError, health]);
  if (!client) return null;
  // Beside "Saved", how fresh the backup is (a vault on this computer; the preview keeps none).
  const backup = activity.state === "saved" && status && client.kind === "vault" ? describeBackup(status) : null;
  const count = activity.state === "external" ? health?.conflicts.length : activity.state === "proposed" ? health?.proposals : undefined;
  const lines = [activity.detail, ...activity.also.map((c) => c.detail)];
  const full = backup ? `${activity.label}. ${backup.label}. ${backup.detail}`.trim() : `${activity.label}. ${lines.join(" ")}`;
  const open = () => {
    if (activity.target === "review") useWorkspace.getState().go({ view: "review" });
    else openSettingsAt({ group: "history", row: "history.health" });
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
        title={backup ? `${activity.detail}\n${backup.label}${backup.detail ? `: ${backup.detail}` : ""}` : lines.join("\n")}
        aria-label={full}
        data-activity={activity.state}
        className={`flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink ${activity.state === "saved" ? "" : "text-muted"}`}
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${DOT[activity.state]}`} />
        <span>{activity.label}</span>
        {count ? <span>· {count}</span> : null}
        {activity.also.length > 0 && <span aria-hidden="true">+{activity.also.length}</span>}
        {status && status.pending > 0 && <span>· {status.pending} edited</span>}
      </button>
      <span role="status" className="sr-only">
        {activity.state === "saved" ? "" : activity.label}
      </span>
    </>
  );
}
