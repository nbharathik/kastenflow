// The coding agents a thread can use instead of an AI provider (Claude Code and
// OpenCode, run as the person's own programs). A thread names one the way it
// names a provider; these are their names, as the app's chat lists them.

export const AGENT_PROVIDERS = ["Claude Code (CLI)", "OpenCode (CLI)"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** Whether `name` is a coding agent rather than an AI provider. */
export const isAgentProvider = (name: string | null | undefined): name is AgentProvider => Boolean(name) && (AGENT_PROVIDERS as readonly string[]).includes(name as string);

/** The id Settings and the commands know the agent by. */
export const agentId = (name: AgentProvider): "claude-code" | "opencode" => (name === "Claude Code (CLI)" ? "claude-code" : "opencode");
