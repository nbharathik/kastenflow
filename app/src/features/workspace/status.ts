// The vault's history and backup as the status bar and settings show them,
// and how the window keeps in step with the vault while it is open: files
// changed outside Kasten reload the list and the open page, and commits and
// pushes update the backup status.

import { create } from "zustand";

import { relativeTime } from "../../lib/dates";
import type { VaultClient, VaultStatus } from "../../lib/vault/types";
import { boardFilesChanged } from "../boards/events";
import { assetFilesChanged, bibFilesChanged, deckFilesChanged, pageFilesChanged } from "../slides/events";
import { useDecks } from "../slides/store";
import { diagramFilesChanged, useDiagrams } from "../diagrams/store";
import { sourceFilesChanged } from "../sources/events";
import { useBoards } from "../boards/store";
import { forgetSchemas } from "../panel/properties/schemas";
import { useTags } from "../tags/store";
import { filesChanged } from "./page/open-page";
import { useWorkspace } from "./store";

interface StatusState {
  status: VaultStatus | null;
  /** The clock's last error (a commit or push that failed), if any. */
  error: string | null;
  refresh(): Promise<void>;
}

export const useVaultStatus = create<StatusState>()((set) => ({
  status: null,
  error: null,
  async refresh() {
    const client = useWorkspace.getState().client;
    if (!client) return set({ status: null });
    try {
      set({ status: await client.status() });
    } catch {
      // Keep the last status; the next tick tries again.
    }
  },
}));

export type Tone = "off" | "ok" | "stale" | "failing";

type Said = { tone: Tone; label: string; detail: string };

/** How good a tone is, for taking the better of two copies: a copy that
 * fails still says more than none at all. */
const RANK: Record<Tone, number> = { off: -1, failing: 0, stale: 1, ok: 2 };

/** The backup remote in words. */
function describeRemote(status: VaultStatus, now: number): Said {
  const { backup } = status;
  const last = backup.lastPush ? `Backed up ${relativeTime(backup.lastPush, now)}` : "Not backed up yet";
  switch (backup.state) {
    case "off":
      return { tone: "off", label: "Backup off", detail: "Saved changes are recorded in history on this computer. Add a backup in Settings for a copy somewhere else." };
    case "ok":
      return { tone: "ok", label: last, detail: status.remote ?? "" };
    case "stale":
      return { tone: "stale", label: last, detail: "The last backup is over a day old" };
    case "failing":
      return { tone: "failing", label: "Backup failing", detail: backup.lastError ?? "Pushing to the remote failed" };
    case "unconfirmed":
      return {
        tone: "stale",
        label: "Backup waiting for you",
        detail: `This vault's settings name ${status.remote ?? "a remote"}. Nothing is pushed there from this computer until you choose Back up now in Settings.`,
      };
  }
}

/** The backup files in words. */
function describeFile(file: NonNullable<VaultStatus["backupFile"]>, now: number): Said {
  const last = file.lastWritten ? `Backed up to a file ${relativeTime(file.lastWritten, now)}` : "No backup file yet";
  switch (file.state) {
    case "ok":
      return { tone: "ok", label: last, detail: file.path ?? "" };
    case "stale":
      return { tone: "stale", label: last, detail: "The newest backup file is over a day old" };
    case "failing":
      return { tone: "failing", label: "Backup file failing", detail: file.lastError ?? "Writing the backup file failed" };
    default:
      return { tone: "off", label: last, detail: "The first backup file is written once the vault is quiet" };
  }
}

/** The status bar's words and colour for the backup: the freshest copy
 * off this computer, a remote or a backup file. */
export function describeBackup(status: VaultStatus, now = Date.now()): Said {
  if (!status.history) return { tone: "off", label: "No history", detail: "Turn on history in Settings to keep every version" };
  if (status.backup.behind) {
    return { tone: "stale", label: "Newer changes in the backup", detail: "Another computer backed up changes this one doesn't have. Get latest in Settings → History and backup." };
  }
  const remote = describeRemote(status, now);
  if (!status.backupFile) return remote;
  const file = describeFile(status.backupFile, now);
  return RANK[file.tone] > RANK[remote.tone] ? file : remote;
}

/** Follows the core's events and checks the status each minute; returns how to stop. */
export function startLive(client: VaultClient): () => void {
  void useVaultStatus.getState().refresh();
  void useBoards.getState().load();
  void useDecks.getState().load();
  void useDiagrams.getState().load();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting = new Set<string>();
  const stop = client.watch?.({
    changed(paths) {
      filesChanged(paths);
      boardFilesChanged(paths);
      deckFilesChanged(paths);
      diagramFilesChanged(paths);
      assetFilesChanged(paths);
      bibFilesChanged(paths);
      pageFilesChanged(paths);
      sourceFilesChanged(paths);
      if (paths.some((p) => p.startsWith("tags/") && p.endsWith(".yaml"))) {
        forgetSchemas();
        void useTags.getState().load();
      }
      for (const path of paths) waiting.add(path);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = [...waiting];
        waiting = new Set();
        void useWorkspace.getState().filesChanged(changed);
      }, 150);
    },
    committed() {
      useVaultStatus.setState({ error: null });
      void useVaultStatus.getState().refresh();
    },
    error(message) {
      useVaultStatus.setState({ error: message });
    },
  });
  const every = setInterval(() => void useVaultStatus.getState().refresh(), 60_000);
  return () => {
    stop?.();
    clearInterval(every);
    if (timer) clearTimeout(timer);
  };
}
