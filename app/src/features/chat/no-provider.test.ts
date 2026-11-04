import { describe, expect, it } from "vitest";

import { hasNoProvider } from "./no-provider";
import type { ChatProvider } from "./types";

const provider = (over: Partial<ChatProvider>): ChatProvider => ({ name: "P", kind: "openai", baseUrl: "", model: "m", hasKey: false, confirmed: true, ...over });
const agent = (hasKey: boolean): ChatProvider => provider({ name: "Claude Code (CLI)", kind: "cli", hasKey });

describe("whether a chat has nothing to answer with", () => {
  it("is not decided while the list is being read", () => {
    expect(hasNoProvider(null)).toBe(false);
  });

  it("is true for an empty list", () => {
    expect(hasNoProvider([])).toBe(true);
  });

  it("is still true when the only entries are coding agents that are not installed", () => {
    expect(hasNoProvider([agent(false), { ...agent(false), name: "OpenCode (CLI)" }])).toBe(true);
  });

  it("is false for an installed coding agent, and for a provider that is set up", () => {
    expect(hasNoProvider([agent(true)])).toBe(false);
    expect(hasNoProvider([agent(false), provider({ hasKey: true })])).toBe(false);
  });
});
