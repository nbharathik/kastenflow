// Health through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/health.rs).

import { invoke } from "@tauri-apps/api/core";

import type { Health, HealthOps } from "./health-types";

export const tauriHealth: HealthOps = {
  vaultHealth: () => invoke<Health>("vault_health"),
};
