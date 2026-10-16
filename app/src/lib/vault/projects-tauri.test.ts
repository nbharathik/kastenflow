// The project, revision and health calls reach the commands the app's backend
// registers, with the arguments it reads.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { tauriHealth } from "./health-tauri";
import { tauriProjects } from "./projects-tauri";
import { tauriRevisions } from "./revisions-tauri";

beforeEach(() => invoke.mockClear());

describe("the project calls", () => {
  it("send the state change as the core reads it, keys left out staying out", async () => {
    await tauriProjects.setProjectState("projects/a/_project.md", { status: "Paused", health: null });
    expect(invoke).toHaveBeenCalledWith("set_project_state", { path: "projects/a/_project.md", change: { status: "Paused", health: null } });
    // JSON drops what is undefined, so a key left out is a key the core leaves alone.
    const sent = JSON.parse(JSON.stringify(invoke.mock.calls[0]![1] as object)) as { change: Record<string, unknown> };
    expect(sent.change).toEqual({ status: "Paused", health: null });
  });

  it("ask for summaries by the person's day, today unless one is given", async () => {
    await tauriProjects.projectSummaries("2026-10-06");
    expect(invoke).toHaveBeenLastCalledWith("project_summaries", { today: "2026-10-06" });
    await tauriProjects.projectSummaries();
    expect((invoke.mock.calls.at(-1)![1] as { today: string }).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("preview and apply a setup to a new or an existing project", async () => {
    await tauriProjects.listSetups();
    expect(invoke).toHaveBeenLastCalledWith("list_setups");
    await tauriProjects.previewSetup("research", { kind: "new", title: "Thesis" });
    expect(invoke).toHaveBeenLastCalledWith("preview_setup", { id: "research", target: { kind: "new", title: "Thesis" } });
    await tauriProjects.applySetup("writing", { kind: "existing", folder: "essay" });
    expect(invoke).toHaveBeenLastCalledWith("apply_setup", { id: "writing", target: { kind: "existing", folder: "essay" } });
  });
});

describe("the revision and health calls", () => {
  it("read the counters and the report", async () => {
    await tauriRevisions.revision();
    expect(invoke).toHaveBeenLastCalledWith("vault_revision");
    await tauriHealth.vaultHealth();
    expect(invoke).toHaveBeenLastCalledWith("vault_health");
  });
});
