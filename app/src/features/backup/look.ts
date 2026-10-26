// Looking at the backup for changes other computers made, on a timer, and
// telling the person what came of it. The engine decides when a look is due
// (every `backup.fetch_interval` minutes, 15 by default) and whether taking
// the changes in is safe; this side ticks each minute, and says whether any
// open page has unsaved edits, because only the window knows. Nothing is taken
// in while one does. A merge is never done: the person is asked.

import { invoke } from "@tauri-apps/api/core";

import { useShell } from "../../lib/store";
import type { AutoPull, LookDue } from "../../lib/vault/backup-types";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { canBackUp } from "./api";
import { runGetLatest } from "./latest";
import { useBackupPopover } from "./popover-state";
import { useBackupStatus } from "./use-backup-status";

/** Wait after opening, so the first look never slows the first screen. */
const FIRST_MS = 4_000;
/** How often the window asks the engine whether a look is due. */
const TICK_MS = 60_000;

/** Whether any open page has edits that are not saved yet (waiting, being written, or failed). */
export function hasUnsavedEdits(): boolean {
  return Object.values(useShell.getState().saveStates).some((state) => state !== "saved");
}

const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

/** Says what a look came to; nothing for the quiet answers. */
export function tellLook(answer: AutoPull, told: { available: boolean }): void {
  const { toast, go, refresh } = useWorkspace.getState();
  if (answer.result === "brought") {
    void refresh();
    toast(`Brought in ${changes(answer.changes)} from another computer`, { label: "See changes", run: () => go({ view: "history" }) });
  } else if (answer.result === "available") {
    if (told.available) return;
    told.available = true;
    toast(answer.merge ? "The backup has changes from another computer, and so do you. Get latest keeps both" : "The backup has changes from another computer", {
      label: "Get latest",
      run: () => void runGetLatest(),
    });
  } else if (answer.result === "upToDate") {
    told.available = false;
  }
}

/** One tick: asks whether a look is due and, if so, looks. Answers what the look did, or null. */
export async function lookOnce(told = { available: false }): Promise<AutoPull | null> {
  if (!canBackUp()) return null;
  const unsavedEdits = hasUnsavedEdits();
  try {
    const due = await invoke<LookDue>("backup_look_due", { unsavedEdits });
    if (!due.due) return null;
    // Typing may have started while the engine answered: ask again, at the last moment.
    const answer = await invoke<AutoPull>("backup_look", { unsavedEdits: unsavedEdits || hasUnsavedEdits() });
    tellLook(answer, told);
    void useVaultStatus.getState().refresh();
    void useBackupStatus.getState().refresh();
    return answer;
  } catch {
    // Offline or the backup is away: the next tick tries again.
    return null;
  }
}

/** Tells once, per run, that the backup has been failing for a while. */
export function tellFailing(failing: boolean, told: { failing: boolean }): void {
  if (!failing) {
    told.failing = false;
    return;
  }
  if (told.failing) return;
  told.failing = true;
  useWorkspace.getState().toast("Backing up has been failing for a while", { label: "Details", run: () => useBackupPopover.setState({ open: true }) });
}

/** Starts looking: a first look soon after opening, then a tick each minute. Returns how to stop. */
export function startBackupLook(): () => void {
  if (!canBackUp()) return () => {};
  const told = { available: false };
  const failed = { failing: false };
  const tick = () => {
    if (document.hidden) return;
    void lookOnce(told);
    tellFailing(useVaultStatus.getState().status?.backup.state === "failing", failed);
  };
  const first = setTimeout(tick, FIRST_MS);
  const every = setInterval(tick, TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
