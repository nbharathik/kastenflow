// The status bar's backup item: how fresh the backup is, and a popover with
// what to do about it. In the browser preview there is no backup to show.

import { useEffect, useRef, useState } from "react";

import { inDemo } from "../../demo/flag";
import { useInterval } from "../../lib/use-interval";
import { describeBackup, useVaultStatus, type Tone } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { canBackUp } from "./api";
import { popoverView } from "./popover-model";
import { StatusPopover } from "./StatusPopover";
import { useBackupStatus } from "./use-backup-status";
import { useBackupPopover } from "./popover-state";

const DOT: Record<Tone, string> = { off: "bg-muted/50", ok: "bg-success", stale: "bg-warning", failing: "bg-danger" };

export function BackupStatusButton() {
  const client = useWorkspace((s) => s.client);
  const vault = useVaultStatus((s) => s.status);
  const waiting = useBackupStatus((s) => s.status?.unpushed ?? 0);
  const open = useBackupPopover((s) => s.open);
  const [, setNow] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);

  // Read again when the vault's status moves (a commit, a push) and each minute, so "2 minutes ago" stays true.
  useEffect(() => {
    void useBackupStatus.getState().refresh();
  }, [vault?.backup.lastPush, vault?.backup.state, vault?.pending]);
  useInterval(() => setNow((n) => n + 1), 60_000);

  if (!client || (client.kind !== "vault" && !inDemo()) || !canBackUp() || !vault) return null;
  const said = describeBackup(vault);
  const view = popoverView(vault, useBackupStatus.getState().status);
  const label = view.off ? "Backup off" : said.label;
  const toggle = (value: boolean) => useBackupPopover.setState({ open: value });
  return (
    <span className="relative shrink-0">
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Backup: ${label}${waiting > 0 ? `, ${waiting} waiting` : ""}`}
        title={said.detail || label}
        onClick={() => toggle(!open)}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink"
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${DOT[said.tone]}`} />
        <span>{label}</span>
        {waiting > 0 && <span>· {waiting} waiting</span>}
      </button>
      {open && <StatusPopover anchor={anchor} onClose={() => toggle(false)} />}
    </span>
  );
}
