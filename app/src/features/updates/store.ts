// The update the app knows of: what the last check found, whether its notes
// are open, the release the person skipped, and how installing it in place
// is going (install.ts). The status bar, Settings and the What's new dialog
// all read it.

import { create } from "zustand";

import { checkUpdate, type UpdateInfo } from "../../lib/api";
import { loadUpdates, updatePrefs } from "./prefs";

/** Installing in place: nothing yet, downloading, downloaded and ready,
 * installing (the app restarts), or failed. */
export type InstallPhase = "idle" | "downloading" | "ready" | "installing" | "failed";

export interface UpdatesState {
  /** What the last check found; null before one, or outside the desktop app. */
  info: UpdateInfo | null;
  checking: boolean;
  /** Why the last check failed. */
  error: string | null;
  /** When a check last answered. */
  checkedAt: number | null;
  /** The What's new dialog is open. */
  open: boolean;
  /** A release the person chose to skip. */
  skipped: string | undefined;
  /** This build installs new versions in place. */
  canInstall: boolean;
  phase: InstallPhase;
  /** How much of the download has come, from 0 to 1, if its size is known. */
  progress: number | null;
  /** Why the last download or install failed. */
  installError: string | null;
  /** Asks for the latest release. Never throws: a failure is kept in `error`. */
  check(run?: () => Promise<UpdateInfo | null>): Promise<UpdateInfo | null>;
  show(): void;
  hide(): void;
  /** Stops announcing this release; a newer one is still announced. */
  skip(): void;
}

export const useUpdates = create<UpdatesState>()((set, get) => ({
  info: null,
  checking: false,
  error: null,
  checkedAt: null,
  open: false,
  skipped: loadUpdates().skipped,
  canInstall: false,
  phase: "idle",
  progress: null,
  installError: null,

  async check(run = checkUpdate) {
    set({ checking: true, error: null });
    try {
      const info = await run();
      set({ info, checking: false, checkedAt: Date.now() });
      return info;
    } catch (err) {
      set({ checking: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  skip() {
    const latest = get().info?.latest;
    if (!latest) return;
    updatePrefs({ skipped: latest });
    set({ skipped: latest, open: false });
  },
}));

/** A newer release the person has not skipped, if the last check found one. */
export const selectAvailable = (s: UpdatesState): UpdateInfo | null => (s.info?.newer && s.info.latest !== s.skipped ? s.info : null);

/** The words for a newer release. */
export const outText = (info: UpdateInfo) => `${info.name.includes(info.latest) ? info.name : `KastenFlow ${info.latest}`} is out (this is ${info.current})`;
