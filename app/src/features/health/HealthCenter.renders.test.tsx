// The health page draws again for what it shows, not for every save that
// starts or ends or every count a typed page brings back.

import { act, cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import { useDiagramEditor } from "../diagrams/editor";
import { useDiagrams } from "../diagrams/store";
import { previewHealth } from "../workspace/preview/memory-health";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { noteAt } from "../workspace/tree";
import { HealthCenter } from "./HealthCenter";
import { useHealth } from "./health-store";

const REVISION = { epoch: 1, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };
const PATH = "library/Plan.md";
let commits = 0;

beforeEach(async () => {
  localStorage.clear();
  const vault = new MemoryVault({ [PATH]: "---\ntitle: Plan\n---\nMine.\n" });
  vi.spyOn(vault, "vaultHealth").mockResolvedValue(previewHealth({ revision: REVISION, counts: { notes: 1, boards: 0, decks: 0, diagrams: 0, sources: 0, assets: 0 }, trash: 0, conflicts: [], indexed: 1 }));
  useHealth.setState({ health: null, report: null, error: null });
  useDiagrams.setState({ list: [], loaded: true });
  useDiagramEditor.setState({ info: { version: "32.2.0", bytes: 1, url: "", installed: true, busy: false } });
  useShell.setState({ saveStates: {} });
  await useWorkspace.getState().connect({ client: vault });
  render(
    <Profiler id="health" onRender={() => void commits++}>
      <HealthCenter />
    </Profiler>,
  );
  await screen.findByRole("region", { name: "Saving and indexing" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useWorkspace.setState({ client: null });
});

describe("the health page's drawing", () => {
  it("does not draw again while a save goes from edited to saving", () => {
    act(() => useShell.setState({ saveStates: { [PATH]: "edited" } }));
    const before = commits;
    act(() => useShell.setState({ saveStates: { [PATH]: "saving" } }));
    act(() => useShell.setState({ saveStates: { [PATH]: "saving", "library/Other.md": "edited" } }));
    expect(commits - before).toBe(0);
  });

  it("does not draw again for the counts a typed page brings back", () => {
    const meta = noteAt(useWorkspace.getState().notes, PATH)!;
    const before = commits;
    for (let i = 1; i <= 4; i++) act(() => useWorkspace.getState().noteChanged({ ...meta, words: meta.words + i, modified: meta.modified + i }));
    expect(commits - before).toBe(0);
  });

  it("draws again when a save fails", () => {
    const before = commits;
    act(() => useShell.setState({ saveStates: { [PATH]: "failed" } }));
    expect(commits - before).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Saving and indexing" }).getAttribute("data-level")).toBe("fail");
  });
});
