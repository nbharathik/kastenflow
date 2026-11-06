// The window's side of the agent commands. Inside the desktop app they are
// Tauri commands; in the browser preview there is no program to start, so the
// agents are listed as not found and no card is ever asked.

import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "../../../lib/api";
import { AGENT_PROVIDERS } from "./names";
import type { AgentCheck, AgentInfo } from "./types";

const PREVIEW_NOTE = "Coding agents run as programs on your computer, in the desktop app.";

/** The agents on this computer, with where each program is and its version. */
export async function listAgents(): Promise<AgentInfo[]> {
  if (inTauri()) return invoke<AgentInfo[]>("agents_list");
  return AGENT_PROVIDERS.map((provider) => ({
    id: provider === "Claude Code (CLI)" ? "claude-code" : "opencode",
    label: provider.replace(" (CLI)", ""),
    provider,
    found: false,
    path: null,
    version: null,
    install: PREVIEW_NOTE,
    signIn: PREVIEW_NOTE,
  }));
}

/** Starts the agent's program for its version and asks whether it is signed in. */
export async function testAgent(id: AgentInfo["id"]): Promise<AgentCheck> {
  if (inTauri()) return invoke<AgentCheck>("agents_test", { id });
  return { ok: false, version: null, signedIn: null, message: PREVIEW_NOTE };
}

/** Answers an agent's question with the card's button. Whether the question was still open. */
export async function answerApproval(chat: string, id: string, allow: boolean, message?: string): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>("chat_agent_answer", { chat, id, allow, ...(message ? { message } : {}) });
}
