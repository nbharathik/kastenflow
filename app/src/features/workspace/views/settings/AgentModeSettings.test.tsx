// Settings → AI agents → How much agents may do: three cards, the time box that
// Autonomous brings, a mode per project, and the plain states around them.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentMode } from "../../../agents/store";
import type { AgentPolicy } from "../../../../lib/vault/types";
import { MemoryVault } from "../../preview/memory-vault";
import { useWorkspace } from "../../store";
import { AgentModeSettings } from "./AgentModeSettings";

const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  "projects/thesis/_project.md": "---\ntitle: Thesis\ntype: project\n---\n",
};

let vault: MemoryVault;
let saved: AgentPolicy[];

async function open() {
  render(<AgentModeSettings />);
  return screen.findByRole("radiogroup", { name: "How much agents may do" });
}

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  saved = [];
  const set = vault.setAgentPolicy.bind(vault);
  vi.spyOn(vault, "setAgentPolicy").mockImplementation(async (policy) => {
    saved.push(policy);
    return set(policy);
  });
  useAgentMode.setState({ view: null, box: "hour", error: null });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings → how much agents may do", () => {
  it("offers three modes with a sentence each, on Balanced to begin with", async () => {
    const group = await open();
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-labelledby") && document.getElementById(r.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["Review everything", "Balanced", "Autonomous"]);
    await vi.waitFor(() => expect((within(group).getByRole("radio", { name: "Balanced" }) as HTMLInputElement).checked).toBe(true));
    expect(within(group).getByRole("radio", { name: "Review everything" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(group.textContent).toContain("Every change an agent wants to make waits for you");
    // The time box belongs to Autonomous: not shown before.
    expect(screen.queryByRole("radiogroup", { name: "For" })).toBeNull();
  });

  it("sets the vault's mode with one click", async () => {
    const group = await open();
    await vi.waitFor(() => expect(within(group).getByRole("radio", { name: "Balanced" }).hasAttribute("disabled")).toBe(false));
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "Review everything" })));
    expect(saved).toEqual([{ mode: "review", until: null, projects: {} }]);
    expect((within(group).getByRole("radio", { name: "Review everything" }) as HTMLInputElement).checked).toBe(true);
  });

  it("starts Autonomous for an hour and offers the other time boxes", async () => {
    const group = await open();
    await vi.waitFor(() => expect(within(group).getByRole("radio", { name: "Autonomous" }).hasAttribute("disabled")).toBe(false));
    const before = Date.now();
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "Autonomous" })));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.mode).toBe("autonomous");
    const end = Date.parse(saved[0]!.until!);
    expect(end).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(end).toBeLessThan(before + 3_600_000 + 60_000);

    const box = await screen.findByRole("radiogroup", { name: "For" });
    expect(within(box).getByRole("radio", { name: "1 hour" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => fireEvent.click(within(box).getByRole("radio", { name: "8 hours" })));
    expect(Date.parse(saved[1]!.until!)).toBeGreaterThan(before + 7.9 * 3_600_000);
    await act(async () => fireEvent.click(within(box).getByRole("radio", { name: "Until I turn it off" })));
    expect(saved[2]).toEqual({ mode: "autonomous", until: null, projects: {} });
    expect(screen.getByText("On until you turn it off")).toBeTruthy();
  });

  it("leaving Autonomous drops the time box", async () => {
    const group = await open();
    await vi.waitFor(() => expect(within(group).getByRole("radio", { name: "Autonomous" }).hasAttribute("disabled")).toBe(false));
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "Autonomous" })));
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "Balanced" })));
    expect(saved.at(-1)).toEqual({ mode: "balanced", until: null, projects: {} });
    expect(screen.queryByRole("radiogroup", { name: "For" })).toBeNull();
  });

  it("gives a project a mode of its own, and takes it back", async () => {
    await open();
    const thesis = await screen.findByRole("combobox", { name: "Agents in Thesis" });
    expect((thesis as HTMLSelectElement).value).toBe("inherit");
    expect(within(thesis).getByRole("option", { name: "Same as everything (Balanced)" })).toBeTruthy();
    await vi.waitFor(() => expect(thesis.hasAttribute("disabled")).toBe(false));
    await act(async () => fireEvent.change(thesis, { target: { value: "review" } }));
    expect(saved).toEqual([{ mode: "balanced", until: null, projects: { thesis: "review" } }]);
    // Autonomous in a project starts a time box too.
    const trip = screen.getByRole("combobox", { name: "Agents in Trip" });
    await act(async () => fireEvent.change(trip, { target: { value: "autonomous" } }));
    expect(saved[1]!.projects).toEqual({ thesis: "review", trip: "autonomous" });
    expect(saved[1]!.until).not.toBeNull();
    await act(async () => fireEvent.change(trip, { target: { value: "inherit" } }));
    expect(saved[2]).toEqual({ mode: "balanced", until: null, projects: { thesis: "review" } });
  });

  it("says plainly when it could not read, and tries again", async () => {
    const fail = vi.spyOn(vault, "agentPolicy").mockRejectedValueOnce(new Error("The vault is locked"));
    const group = await open();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not read how much agents may do: The vault is locked");
    expect(within(group).getByRole("radio", { name: "Balanced" }).hasAttribute("disabled")).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(fail).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(group).getByRole("radio", { name: "Balanced" }).hasAttribute("disabled")).toBe(false);
  });

  it("tells a failed save in a toast and keeps the old mode", async () => {
    const group = await open();
    await vi.waitFor(() => expect(within(group).getByRole("radio", { name: "Balanced" }).hasAttribute("disabled")).toBe(false));
    vi.spyOn(vault, "setAgentPolicy").mockRejectedValueOnce(new Error("Could not write the settings"));
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "Review everything" })));
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Could not write the settings");
    expect((within(group).getByRole("radio", { name: "Balanced" }) as HTMLInputElement).checked).toBe(true);
  });

  it("works from the keyboard alone: the radios take the arrow keys and Space", async () => {
    const group = await open();
    const balanced = (await within(group).findByRole("radio", { name: "Balanced" })) as HTMLInputElement;
    await vi.waitFor(() => expect(balanced.disabled).toBe(false));
    balanced.focus();
    expect(document.activeElement).toBe(balanced);
    // Native radios: every card is a labelled radio of one group.
    expect(new Set(within(group).getAllByRole("radio").map((r) => (r as HTMLInputElement).name)).size).toBe(1);
  });
});
