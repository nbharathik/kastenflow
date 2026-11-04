import type { ChatProvider } from "./types";

/**
 * Whether there is nothing to answer a chat with: no AI provider is set up and no coding agent is installed. The two coding agents are
 * always in the list (an agent that is not installed shows as such), so they count only when installed (`hasKey`). Null while the list is
 * still being read: that is not "none".
 */
export const hasNoProvider = (providers: readonly ChatProvider[] | null): boolean => providers !== null && !providers.some((p) => p.kind !== "cli" || p.hasKey);
