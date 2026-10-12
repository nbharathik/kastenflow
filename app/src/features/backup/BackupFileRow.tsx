// Backup files for Dropbox, Google Drive, OneDrive or a disk: a file of the
// whole vault, history and all, written daily into a folder those keep,
// once the vault is quiet. The newest 7 from this computer are kept.
// Backup files are not encrypted; the folder's own service keeps them.

import { useState } from "react";

import { relativeTime } from "../../lib/dates";
import { FolderPicker } from "../vaults/FolderPicker";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { backupFileNow, setBackupFolder } from "./api";
import { BUTTON, message, type RowComponent } from "./parts";

export function BackupFileRow({ Row }: { Row: RowComponent }) {
  const status = useVaultStatus((s) => s.status);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useWorkspace.getState();
  if (!status?.history) return null;

  const folder = status.backupFolder ?? null;
  const file = status.backupFile ?? null;
  const write = async () => {
    setBusy(true);
    try {
      const made = await backupFileNow();
      toast(made.written ? "Backup file written" : "The newest backup file already holds everything");
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
      void useVaultStatus.getState().refresh();
    }
  };
  const choose = async (path: string) => {
    setPicking(false);
    try {
      await setBackupFolder(path);
      await useVaultStatus.getState().refresh();
      await write();
    } catch (err) {
      toast(message(err));
    }
  };
  const stop = async () => {
    try {
      await setBackupFolder(null);
      toast("Backup files stopped. The files already written stay where they are");
    } catch (err) {
      toast(message(err));
    } finally {
      void useVaultStatus.getState().refresh();
    }
  };

  const written = file?.lastWritten ? `Last written ${relativeTime(file.lastWritten)}` : "None written yet";
  const failing = file?.state === "failing" && file.lastError ? file.lastError : "";
  // What it did last stays in view; where it writes and what it keeps are behind the ?.
  const help = folder
    ? `Writes into ${folder}. The newest 7 from ${status.computer ?? "this computer"} are kept. Backup files are not encrypted; the folder's own service keeps them.`
    : "For Dropbox, Google Drive, OneDrive or a disk: a file of the whole vault in their folder, written daily. Not encrypted.";
  return (
    <>
      <Row label="Backup files" detail={folder ? (failing ? `${written}. ${failing}` : written) : undefined} help={help}>
        <div className="flex items-center gap-1.5">
          {folder && (
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void write()}>
              {busy ? "Writing…" : "Write now"}
            </button>
          )}
          <button type="button" className={BUTTON} disabled={busy} onClick={() => setPicking(true)}>
            {folder ? "Change…" : "Choose folder…"}
          </button>
          {folder && (
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void stop()}>
              Stop
            </button>
          )}
        </div>
      </Row>
      {picking && <FolderPicker title="Where backup files go" start={folder ?? undefined} onPick={(path) => void choose(path)} onClose={() => setPicking(false)} />}
    </>
  );
}
