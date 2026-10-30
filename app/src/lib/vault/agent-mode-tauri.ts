// The agent modes through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/agent_modes.rs).

import { invoke } from "@tauri-apps/api/core";

import type { AgentModeOps, AgentPolicyView, Checkpoint } from "./agent-mode-types";
import type { VaultRestore } from "./status-types";

export const tauriAgentModes: AgentModeOps = {
  agentPolicy: () => invoke<AgentPolicyView>("agent_policy"),
  setAgentPolicy: (policy) => invoke<AgentPolicyView>("set_agent_policy", { policy }),
  checkpoints: () => invoke<Checkpoint[]>("list_checkpoints"),
  restoreToCheckpoint: (id) => invoke<VaultRestore>("restore_to_checkpoint", { id }),
};
