// The vault's health in the window: the report, read when asked for (the status
// area, the health page) and kept until the next reading, and the problems of
// the last check run here. Looking changes nothing in the vault; a check
// reads every file and writes only its own note of when it ran.

import { create } from "zustand";

import type { Health } from "../../lib/vault/health-types";
import type { VerifyReport } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";

interface HealthState {
  health: Health | null;
  /** The problems of the last check run in this window; none before one is. */
  report: VerifyReport | null;
  /** Why the last reading failed; the report before it stays. */
  error: string | null;
  refresh(): Promise<void>;
  /** Checks the vault (the core's verify) and keeps what it found; throws what went wrong. */
  check(): Promise<VerifyReport | null>;
}

/** Readings can cross; only the newest one is kept. */
let latest = 0;

export const useHealth = create<HealthState>()((set, get) => ({
  health: null,
  report: null,
  error: null,
  async refresh() {
    const ticket = ++latest;
    const client = useWorkspace.getState().client;
    if (!client) return set({ health: null, report: null, error: null });
    try {
      const health = await client.vaultHealth();
      if (ticket === latest) set({ health, error: null });
    } catch (err) {
      if (ticket === latest) set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  async check() {
    const client = useWorkspace.getState().client;
    if (!client) return null;
    const report = await client.verify();
    set({ report });
    await get().refresh();
    return report;
  },
}));
