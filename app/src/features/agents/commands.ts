// The palette's way to set how much agents may do: "Agents: Review everything",
// "Agents: Balanced", "Agents: Autonomous". Autonomous starts for an hour, so
// it never stays on by accident; Settings → AI agents has the other time boxes.

import { useWorkspace } from "../workspace/store";
import { modeToast, useAgentMode } from "./store";
import { MODE_NAMES } from "./policy";
import type { AgentMode } from "../../lib/vault/types";

const WORDS: Record<AgentMode, string> = {
  review: "agents ask permission approve every change wait",
  balanced: "agents usual default ordinary big risky wait",
  autonomous: "agents free hands off yolo trust unattended time box hour",
};

async function pick(mode: AgentMode): Promise<void> {
  const { setMode } = useAgentMode.getState();
  if (!(await setMode(mode))) return;
  const view = useAgentMode.getState().view;
  if (view) useWorkspace.getState().toast(modeToast(view));
}

export const AGENT_MODE_COMMANDS = (["review", "balanced", "autonomous"] as const).map((mode) => ({
  id: `agents-${mode}`,
  label: `Agents: ${MODE_NAMES[mode]}`,
  words: WORDS[mode],
  run: () => void pick(mode),
}));
