// "Agents: Review everything / Balanced / Autonomous" in the palette.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../workspace/overlays/commands";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { useAgentMode } from "./store";

let vault: MemoryVault;
const run = async (id: string) => {
  COMMANDS.find((c) => c.id === id)!.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
};

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault({});
  useAgentMode.setState({ view: null, box: "hour", error: null });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
});

describe("the agent mode commands", () => {
  it("are three, named as the palette words them", () => {
    const labels = COMMANDS.filter((c) => ["agents-review", "agents-balanced", "agents-autonomous"].includes(c.id)).map((c) => c.label);
    expect(labels).toEqual(["Agents: Review everything", "Agents: Balanced", "Agents: Autonomous"]);
  });

  it("set the vault's mode and say so", async () => {
    await run("agents-review");
    expect(await vault.agentPolicy()).toMatchObject({ mode: "review", active: "review" });
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Agents: Review everything");
    await run("agents-balanced");
    expect(await vault.agentPolicy()).toMatchObject({ mode: "balanced", until: null });
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Agents: Balanced");
  });

  it("start Autonomous for an hour, and say how to stop it", async () => {
    const before = Date.now();
    await run("agents-autonomous");
    const policy = await vault.agentPolicy();
    expect(policy.active).toBe("autonomous");
    expect(Date.parse(policy.until!)).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(useWorkspace.getState().toasts.at(-1)?.text).toMatch(/^Autonomous agents are on until .*Turn them off from the icon in the top bar/);
  });

  it("change nothing when what is set cannot be read (a guess would wipe the per-project modes)", async () => {
    await vault.setAgentPolicy({ mode: "balanced", until: null, projects: { thesis: "review" } });
    const writes = vi.spyOn(vault, "setAgentPolicy");
    vi.spyOn(vault, "agentPolicy").mockRejectedValue(new Error("config unreadable"));
    useAgentMode.setState({ view: null, error: null });
    await run("agents-autonomous");
    expect(writes).not.toHaveBeenCalled();
    expect(await useAgentMode.getState().turnOff()).toBe(false);
    expect(await useAgentMode.getState().setProjectMode("thesis", null)).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(useWorkspace.getState().toasts.at(-1)?.text).toContain("nothing was changed");
    vi.restoreAllMocks();
    expect((await vault.agentPolicy()).projects).toEqual({ thesis: "review" });
  });

  it("read what is set just before changing it, so another window's change is not undone", async () => {
    await useAgentMode.getState().load();
    // Another window set a project's mode after this one last looked.
    await vault.setAgentPolicy({ mode: "balanced", until: null, projects: { thesis: "review" } });
    expect(useAgentMode.getState().view?.projects).toEqual({});
    await run("agents-autonomous");
    expect((await vault.agentPolicy()).projects).toEqual({ thesis: "review" });
  });

  it("refuse a change when the fresh read fails even if an old copy is held", async () => {
    await useAgentMode.getState().load();
    const writes = vi.spyOn(vault, "setAgentPolicy");
    vi.spyOn(vault, "agentPolicy").mockRejectedValue(new Error("config unreadable"));
    expect(await useAgentMode.getState().turnOff()).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("leave the other scopes as they were", async () => {
    await vault.setAgentPolicy({ mode: "balanced", until: null, projects: { thesis: "review" } });
    await run("agents-autonomous");
    expect((await vault.agentPolicy()).projects).toEqual({ thesis: "review" });
  });
});
