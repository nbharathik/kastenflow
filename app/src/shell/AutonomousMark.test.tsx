// The small mark in the top bar that says autonomous agents are at work: only
// while any scope is autonomous; its card opens on hover, focus or a click and
// says where and until when, with Turn off and a way to the settings.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { untilFor } from "../features/agents/policy";
import { useAgentMode } from "../features/agents/store";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { useWorkspace } from "../features/workspace/store";
import type { AgentPolicy } from "../lib/vault/types";
import { AutonomousMark } from "./AutonomousMark";

const opened = vi.hoisted(() => vi.fn());
vi.mock("../features/workspace/views/settings/jump", () => ({ openSettingsAt: opened }));

let vault: MemoryVault;
const NAME = "Autonomous agents are on";

async function open(policy?: AgentPolicy) {
  vault = new MemoryVault({});
  if (policy) await vault.setAgentPolicy(policy);
  useAgentMode.setState({ view: null, box: "hour", error: null });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<AutonomousMark />);
  await act(async () => {});
}

const mark = () => screen.queryByRole("button", { name: NAME });
const card = () => screen.queryByRole("group", { name: "Autonomous agents" });

beforeEach(() => {
  localStorage.clear();
  opened.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the autonomous mark in the top bar", () => {
  it("is not there on Balanced or Review everything", async () => {
    await open({ mode: "balanced", until: null, projects: {} });
    expect(mark()).toBeNull();
    cleanup();
    await open({ mode: "review", until: null, projects: {} });
    expect(mark()).toBeNull();
  });

  it("shows while autonomous, with its card closed until asked", async () => {
    await open({ mode: "autonomous", until: untilFor("hour", Date.now()), projects: {} });
    expect(mark()).toBeTruthy();
    expect(mark()!.getAttribute("aria-expanded")).toBe("false");
    expect(card()).toBeNull();
  });

  it("opens on hover with where and until when, and closes when the pointer leaves", async () => {
    await open({ mode: "autonomous", until: untilFor("hour", Date.now()), projects: {} });
    fireEvent.mouseEnter(mark()!);
    const info = card()!;
    expect(info.textContent).toContain("Autonomous agents are on");
    expect(info.textContent).toContain("WhereAll your notes");
    expect(info.textContent).toMatch(/ForUntil \d{1,2}:\d{2}/);
    expect(within(info).getByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(within(info).getByRole("button", { name: "Agent settings" })).toBeTruthy();
    fireEvent.mouseLeave(mark()!);
    expect(card()).toBeNull();
  });

  it("opens on keyboard focus, stays while focus is inside, and Escape closes it", async () => {
    await open({ mode: "autonomous", until: null, projects: {} });
    act(() => mark()!.focus());
    expect(card()!.textContent).toContain("ForUntil you turn it off");
    // Tab on to the buttons in the card: it stays.
    act(() => within(card()!).getByRole("button", { name: "Turn off" }).focus());
    expect(card()).toBeTruthy();
    fireEvent.keyDown(card()!, { key: "Escape" });
    expect(card()).toBeNull();
    // Focus leaving closes it too.
    act(() => mark()!.focus());
    expect(card()).toBeTruthy();
    act(() => mark()!.blur());
    expect(card()).toBeNull();
  });

  it("opens on a click (touch) and stays until clicked again", async () => {
    await open({ mode: "autonomous", until: null, projects: {} });
    fireEvent.click(mark()!);
    expect(card()).toBeTruthy();
    expect(mark()!.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseLeave(mark()!);
    expect(card()).toBeTruthy();
    fireEvent.click(mark()!);
    expect(card()).toBeNull();
  });

  it("names the projects when only they are autonomous", async () => {
    await open({ mode: "balanced", until: null, projects: { "note-taking": "autonomous", thesis: "review" } });
    fireEvent.mouseEnter(mark()!);
    expect(card()!.textContent).toContain("WhereNote taking");
  });

  it("turns off with one click, and the mark goes", async () => {
    await open({ mode: "autonomous", until: untilFor("hour", Date.now()), projects: {} });
    fireEvent.mouseEnter(mark()!);
    await act(async () => fireEvent.click(within(card()!).getByRole("button", { name: "Turn off" })));
    expect(mark()).toBeNull();
    expect(await vault.agentPolicy()).toMatchObject({ mode: "balanced", until: null, active: "balanced" });
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Autonomous agents are off.");
  });

  it("leaves the stricter project modes when it turns off", async () => {
    await open({ mode: "balanced", until: null, projects: { talks: "autonomous", thesis: "review" } });
    fireEvent.mouseEnter(mark()!);
    await act(async () => fireEvent.click(within(card()!).getByRole("button", { name: "Turn off" })));
    expect(await vault.agentPolicy()).toMatchObject({ projects: { thesis: "review" }, autonomousProjects: [] });
  });

  it("opens the agent settings at the mode and closes the card", async () => {
    await open({ mode: "autonomous", until: null, projects: {} });
    fireEvent.mouseEnter(mark()!);
    fireEvent.click(within(card()!).getByRole("button", { name: "Agent settings" }));
    expect(opened).toHaveBeenCalledWith({ group: "agents", row: "agents.mode" });
    expect(card()).toBeNull();
  });

  it("keeps the mark and says why when turning off fails", async () => {
    await open({ mode: "autonomous", until: null, projects: {} });
    vi.spyOn(vault, "setAgentPolicy").mockRejectedValueOnce(new Error("Could not write the settings"));
    fireEvent.mouseEnter(mark()!);
    await act(async () => fireEvent.click(within(card()!).getByRole("button", { name: "Turn off" })));
    expect(mark()).toBeTruthy();
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Could not write the settings");
  });

  it("goes when the time box ends, without being asked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await open({ mode: "autonomous", until: untilFor("hour", Date.now()), projects: {} });
    expect(mark()).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(61 * 60_000);
    });
    expect(mark()).toBeNull();
  });
});
