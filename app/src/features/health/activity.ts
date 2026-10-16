// The one indicator in the status area. It reads state the window already has:
// each open page's save state, the vault's commit error, and the health report
// (index, external-edit copies, proposals, backup). The most urgent state is
// shown; the others are listed behind it, so nothing is hidden by a calmer word.

import type { Health } from "../../lib/vault/health-types";
import type { SaveState } from "../workspace/page/page-session";

export type ActivityState = "saved" | "saving" | "indexing" | "external" | "proposed" | "stale" | "failed";

/** Most urgent first. */
export const ACTIVITY_ORDER = ["failed", "external", "proposed", "saving", "indexing", "stale"] as const satisfies readonly ActivityState[];

export const ACTIVITY_LABELS: Record<ActivityState, string> = {
  saved: "Saved",
  saving: "Saving…",
  indexing: "Indexing…",
  external: "External changes",
  proposed: "Proposed",
  stale: "Stale",
  failed: "Failed",
};

/** Where a click on the state goes: Settings → History and backup (where the health page is), or Review. */
export type ActivityTarget = "history" | "review";

export interface ActivityInput {
  /** The save state of every page that has one, by path. */
  saves: Readonly<Record<string, SaveState>>;
  /** The last commit or push the core could not finish, if any. */
  commitError: string | null;
  /** The health report; none yet in the first moments, or when the vault has none. */
  health: Health | null;
}

export interface Condition {
  state: Exclude<ActivityState, "saved">;
  /** A sentence about it. */
  detail: string;
}

export interface Activity {
  state: ActivityState;
  label: string;
  detail: string;
  /** The other things going on, most urgent first. */
  also: Condition[];
  target: ActivityTarget | null;
}

const TARGETS: Record<ActivityState, ActivityTarget | null> = {
  failed: "history",
  external: "history",
  proposed: "review",
  stale: "history",
  saving: null,
  indexing: null,
  saved: null,
};

const many = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

/** Everything that is going on, in the order of ACTIVITY_ORDER. */
function conditionsOf({ saves, commitError, health }: ActivityInput): Condition[] {
  const states = Object.values(saves);
  const found: Condition[] = [];
  const failures: string[] = [];
  const unsaved = Object.keys(saves).find((path) => saves[path] === "failed");
  if (unsaved !== undefined) failures.push(`${unsaved} could not be saved. Your edits are still in the window.`);
  if (commitError) failures.push(`History could not be updated: ${commitError}`);
  if (health?.backup.state === "failing") failures.push(`Backup is failing: ${health.backup.lastError ?? "pushing to the remote failed"}`);
  if (health?.backupFile?.state === "failing") failures.push(`Backup file is failing: ${health.backupFile.lastError ?? "writing it failed"}`);
  if (failures.length > 0) found.push({ state: "failed", detail: failures.join(" ") });
  if (health && health.conflicts.length > 0) {
    found.push({ state: "external", detail: `${many(health.conflicts.length, "copy was", "copies were")} kept after a file changed outside KastenFlow.` });
  }
  if (health && health.proposals > 0) found.push({ state: "proposed", detail: `${many(health.proposals, "change is", "changes are")} waiting for your review.` });
  if (states.some((s) => s === "edited" || s === "saving")) found.push({ state: "saving", detail: "Your latest edits are being written." });
  if (health && health.index.unindexed > 0) found.push({ state: "indexing", detail: `${many(health.index.unindexed, "file is", "files are")} not in the search index yet.` });
  const old = health?.backup.state === "stale" || health?.backup.state === "unconfirmed" || health?.backup.behind || health?.backupFile?.state === "stale";
  if (old) found.push({ state: "stale", detail: staleDetail(health) });
  return found;
}

function staleDetail(health: Health | null): string {
  if (health?.backup.behind) return "Another computer backed up changes this one does not have. Get latest in Settings.";
  if (health?.backup.state === "unconfirmed") return "The vault names a backup that no one confirmed on this computer, so nothing is pushed yet.";
  if (health?.backup.state === "stale") return "The last backup is over a day old.";
  return "The newest backup file is over a day old.";
}

/** The state to show, with a sentence about it and the others behind it. */
export function activityOf(input: ActivityInput): Activity {
  const found = conditionsOf(input);
  const [first, ...also] = found;
  if (!first) return { state: "saved", label: ACTIVITY_LABELS.saved, detail: "All changes are saved.", also: [], target: null };
  return { state: first.state, label: ACTIVITY_LABELS[first.state], detail: first.detail, also, target: TARGETS[first.state] };
}
