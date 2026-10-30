// Telling people about backup where they are: a step after a new vault is
// made, a Home card while backup is off (dismissed, it comes back after 7
// days), and a line in History. Each opens the guided setup.

import { useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { canBackUp } from "./api";
import { openWizard } from "./open-wizard";

const FIRST_RUN = "kasten.backup-first-run";
const DISMISSED = "kasten.backup-card-dismissed";
/** A dismissed Home card comes back after this long. */
export const CARD_RETURNS_MS = 7 * 24 * 60 * 60 * 1000;

/** Remembers that the next vault to open is a new one, to offer backup once. */
export function askToKeepSafe(): void {
  try {
    localStorage.setItem(FIRST_RUN, "1");
  } catch {
    // No storage: the Home card still says it.
  }
}

/** After a vault was created, once it is open: "Keep your notes safe", with Set up backup (Later is closing it). */
export function useKeepSafeStep(): void {
  const ready = useWorkspace((s) => s.ready);
  useEffect(() => {
    if (!ready || !canBackUp()) return;
    try {
      if (localStorage.getItem(FIRST_RUN) === null) return;
      localStorage.removeItem(FIRST_RUN);
    } catch {
      return;
    }
    useWorkspace.getState().toast("Keep your notes safe: back them up, so a lost computer loses nothing", { label: "Set up backup", run: () => void openWizard() });
  }, [ready]);
}

/** Whether the Home card was put away less than 7 days ago. */
export function cardPutAway(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED));
    return Number.isFinite(at) && at > 0 && now - at < CARD_RETURNS_MS;
  } catch {
    return false;
  }
}

export function putCardAway(now = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED, String(now));
  } catch {
    // Not remembered: the card shows again next time.
  }
}

/** True while this vault keeps history but has no backup. */
function useBackupOff(): boolean {
  const status = useVaultStatus((s) => s.status);
  return canBackUp() && !!status && status.history && status.backup.state === "off";
}

/** The Home card: shown while backup is off. */
export function BackupCard() {
  const off = useBackupOff();
  const [away, setAway] = useState(() => cardPutAway());
  if (!off || away) return null;
  return (
    <section aria-label="Keep your notes safe" className="mb-4 flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-14 font-medium">Keep your notes safe</p>
        <p className="text-13 text-muted">Your notes are on this computer only. A private backup on GitHub takes a few clicks.</p>
      </div>
      <Button tone="primary" size="sm" onClick={() => void openWizard()}>
        Set up backup
      </Button>
      <Button
        tone="quiet"
        size="sm"
        onClick={() => {
          putCardAway();
          setAway(true);
        }}
      >
        Not now
      </Button>
    </section>
  );
}

/** The line in History while backup is off. */
export function HistoryOnlyHere() {
  const off = useBackupOff();
  if (!off) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-13 text-muted">
      History is on this computer only.
      <Button size="sm" onClick={() => void openWizard()}>
        Back it up
      </Button>
    </p>
  );
}
