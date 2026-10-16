// The indicator in the status area: its words follow the state the window has,
// it reads the health report without changing anything, and a click goes to
// what needs a look.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import type { Health } from "../../lib/vault/health-types";
import { previewHealth } from "../workspace/preview/memory-health";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { useSettingsJump } from "../workspace/views/settings/jump";
import { ActivityStatus } from "./ActivityStatus";
import { useHealth } from "./health-store";

const REVISION = { epoch: 1, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };
const report = (patch: Partial<Health> = {}): Health => ({
  ...previewHealth({ revision: REVISION, counts: { notes: 1, boards: 0, decks: 0, diagrams: 0, sources: 0, assets: 0 }, trash: 0, conflicts: [], indexed: 1 }),
  ...patch,
});

let vault: MemoryVault;

/** The health the vault answers with. */
function answer(health: Health) {
  vi.spyOn(vault, "vaultHealth").mockResolvedValue(health);
}

beforeEach(async () => {
  vault = new MemoryVault({ "library/a.md": "---\ntitle: A\n---\nText\n" });
  useHealth.setState({ health: null, error: null });
  useShell.setState({ saveStates: {} });
  useVaultStatus.setState({ status: null, error: null });
  useSettingsJump.setState({ target: null });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.setState({ place: { view: "home" } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useWorkspace.setState({ client: null });
});

const indicator = () => document.querySelector<HTMLElement>("[data-activity]")!;

describe("the activity indicator in the status area", () => {
  it("says Saved when all is well", async () => {
    answer(report());
    render(<ActivityStatus />);
    expect(indicator().dataset.activity).toBe("saved");
    expect(indicator().textContent).toContain("Saved");
    await waitFor(() => expect(vault.vaultHealth).toHaveBeenCalled());
  });

  it("follows each page's save state: Saving while it is edited, Failed when it could not be saved", async () => {
    answer(report());
    render(<ActivityStatus />);
    act(() => useShell.getState().setSaveState("library/a.md", "edited"));
    expect(indicator().dataset.activity).toBe("saving");
    expect(indicator().textContent).toContain("Saving…");
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    act(() => useShell.getState().setSaveState("library/a.md", "failed"));
    expect(indicator().dataset.activity).toBe("failed");
    expect(indicator().getAttribute("title")).toContain("library/a.md could not be saved");
    act(() => useShell.getState().setSaveState("library/a.md", "saved"));
    expect(indicator().dataset.activity).toBe("saved");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("reads the health report: Indexing for files the index has not taken, with the others counted behind it", async () => {
    answer(report({ index: { notes: 1, unindexed: 2, schema: 1 }, backup: { state: "stale", lastPush: 1, failures: 0, lastError: null } }));
    render(<ActivityStatus />);
    await waitFor(() => expect(indicator().dataset.activity).toBe("indexing"));
    expect(indicator().textContent).toContain("Indexing…");
    // One more thing is going on: the stale backup.
    expect(indicator().textContent).toContain("+1");
    expect(indicator().getAttribute("title")).toContain("over a day old");
  });

  it("says Proposed with how many, and a click goes to Review", async () => {
    answer(report({ proposals: 3 }));
    render(<ActivityStatus />);
    await waitFor(() => expect(indicator().dataset.activity).toBe("proposed"));
    expect(indicator().textContent).toContain("Proposed");
    expect(indicator().textContent).toContain("· 3");
    fireEvent.click(indicator());
    expect(useWorkspace.getState().place.view).toBe("review");
  });

  it("says External changes, and a click goes to the health page in Settings", async () => {
    answer(report({ conflicts: ["a (conflict 2026-10-11 09-30).md"] }));
    render(<ActivityStatus />);
    await waitFor(() => expect(indicator().dataset.activity).toBe("external"));
    expect(indicator().textContent).toContain("External changes");
    fireEvent.click(indicator());
    expect(useSettingsJump.getState().target).toEqual({ group: "history", row: "history.health" });
    expect(useWorkspace.getState().place.view).toBe("settings");
  });

  it("looks and changes nothing: no note is written by reading the report or clicking", async () => {
    answer(report({ conflicts: ["a (conflict 2026-10-11 09-30).md"] }));
    const before = (await vault.list()).map((n) => `${n.path}:${n.title}`);
    const writes = [vi.spyOn(vault, "saveBody"), vi.spyOn(vault, "create"), vi.spyOn(vault, "rename"), vi.spyOn(vault, "trash")];
    render(<ActivityStatus />);
    await waitFor(() => expect(indicator().dataset.activity).toBe("external"));
    fireEvent.click(indicator());
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect((await vault.list()).map((n) => `${n.path}:${n.title}`)).toEqual(before);
  });

  it("draws nothing before a vault is open", () => {
    useWorkspace.setState({ client: null });
    render(<ActivityStatus />);
    expect(document.querySelector("[data-activity]")).toBeNull();
  });
});
