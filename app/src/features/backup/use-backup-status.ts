// The backup's richer status (waiting changes, verified, files left out,
// visibility, lost history) from the desktop app, kept beside the vault status
// the window already reads. The browser preview has none.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { BackupStatus } from "../../lib/vault/backup-types";
import { canBackUp } from "./api";

interface State {
  status: BackupStatus | null;
  refresh(): Promise<void>;
}

export const useBackupStatus = create<State>()((set) => ({
  status: null,
  async refresh() {
    if (!canBackUp()) return;
    try {
      set({ status: await invoke<BackupStatus>("backup_status") });
    } catch {
      // Keep the last answer; the next refresh tries again.
    }
  },
}));
