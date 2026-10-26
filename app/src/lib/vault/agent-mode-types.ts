// How much agents may do on their own, and where the vault can be put back to:
// the shapes of the window's agent-mode commands (app/src-tauri/src/commands/
// agent_modes.rs) and the calls the app makes. Only a person sets the mode;
// agents have no tool that reaches it.

import type { DraftRule } from "./draft-rule";
import type { VaultRestore } from "./status-types";

/** `review`: every change waits for you. `balanced`: ordinary changes are made, big or risky ones wait. `autonomous`: agents work freely, and everything can be undone. */
export type AgentMode = "review" | "balanced" | "autonomous";

export const AGENT_MODES: readonly AgentMode[] = ["review", "balanced", "autonomous"];

/** What is set: the vault's mode, until when it holds (an ISO time; null means without end), and the projects with a mode of their own. */
export interface AgentPolicy {
  mode: AgentMode;
  until: string | null;
  projects: Record<string, AgentMode>;
}

/** The policy, and what holds now: a time box that has run out is over, so `active` is balanced again, and so for a project. */
export interface AgentPolicyView extends AgentPolicy {
  /** The vault's mode now. */
  active: AgentMode;
  /** The projects (by folder name) that are autonomous now. */
  autonomousProjects: string[];
}

/** A place the vault can be put back to: noted before an autonomous session's first write and before a big batch. */
export interface Checkpoint {
  id: string;
  session: string;
  head: string;
  /** Milliseconds since the Unix epoch. */
  time: number;
  label: string;
}

export interface AgentModeOps {
  agentPolicy(): Promise<AgentPolicyView>;
  /** One commit, as the person. Resolves to the policy as it now holds. */
  setAgentPolicy(policy: AgentPolicy): Promise<AgentPolicyView>;
  /** Newest first. */
  checkpoints(): Promise<Checkpoint[]>;
  /** Puts the vault back as it was then, as new commits; files made since go to the trash. */
  restoreToCheckpoint(id: string): Promise<VaultRestore>;
}

/** What a call about a draft does, for each call of `AgentModeOps`. */
export const AGENT_MODE_RULES = {
  agentPolicy: "pass",
  setAgentPolicy: "pass",
  checkpoints: "pass",
  restoreToCheckpoint: "pass",
} as const satisfies Record<keyof AgentModeOps, DraftRule>;
