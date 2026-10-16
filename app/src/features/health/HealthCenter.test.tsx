// The health page: it shows how the vault stands from the report and the lists
// the window holds, changes nothing by being looked at, and offers each repair
// as a preview that does nothing until it is asked to.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Health } from "../../lib/vault/health-types";
import type { VerifyReport } from "../../lib/vault/types";
import { useDiagramEditor } from "../diagrams/editor";
import { useDiagrams } from "../diagrams/store";
import { previewHealth } from "../workspace/preview/memory-health";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { useSettingsJump } from "../workspace/views/settings/jump";
import { HealthCenter } from "./HealthCenter";
import { useHealth } from "./health-store";

const COPY = "library/Plan (conflict 2026-10-11 09-30).md";
const SEED = {
  "library/Plan.md": "---\ntitle: Plan\n---\nMine.\n",
  [COPY]: "---\ntitle: Plan\n---\nTheirs.\n",
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  "projects/trip/pages/plan.md": "---\ntitle: Trip plan\n---\nSee [[Hotels]].\n",
};
const REVISION = { epoch: 1, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };

const report = (patch: Partial<Health> = {}): Health => ({
  ...previewHealth({ revision: REVISION, counts: { notes: 4, boards: 0, decks: 0, diagrams: 0, sources: 0, assets: 0 }, trash: 0, conflicts: [], indexed: 4 }),
  history: { on: true, pending: 0, lastCommit: Date.now(), busy: false },
  backup: { state: "ok", lastPush: Date.now() - 3_600_000, failures: 0, lastError: null },
  ...patch,
});

let vault: MemoryVault;
const paths = async () => (await vault.list()).map((n) => n.path);

/** Every call that would write to the vault. */
const WRITERS = ["create", "saveBody", "rename", "move", "moveToInbox", "nest", "convert", "duplicate", "trash", "restore", "setMeta", "updateProps", "setTags", "replaceSection", "append", "saveAsset", "createBoard", "createDeck", "startHistory", "pushNow", "setConfig"] as const;
const watchWrites = () => WRITERS.map((name) => vi.spyOn(vault as never as Record<string, (...args: unknown[]) => unknown>, name));

beforeEach(async () => {
  vault = new MemoryVault(SEED);
  useHealth.setState({ health: null, report: null, error: null });
  useDiagrams.setState({ list: [], loaded: true });
  useDiagramEditor.setState({ info: { version: "32.2.0", bytes: 1, url: "", installed: true, busy: false } });
  useSettingsJump.setState({ target: null });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.setState({ toasts: [], place: { view: "home" } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useWorkspace.setState({ client: null });
});

const section = (name: string) => screen.getByRole("region", { name });

describe("the health page", () => {
  it("shows the sections of the report, each with a word and a sentence", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report({ proposals: 2 }));
    render(<HealthCenter />);
    await screen.findByRole("region", { name: "Saving and indexing" });
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Saving and indexing", "History and backup", "External changes", "Proposed changes", "References and files", "Linked pictures", "Search by meaning", "Drawing and the browser"]);
    expect(within(section("Saving and indexing")).getByText("All changes are saved.")).toBeTruthy();
    expect(section("Proposed changes").textContent).toContain("2 changes");
    expect(section("Proposed changes").getAttribute("data-level")).toBe("info");
    expect(section("History and backup").textContent).toContain("Backed up 1 hour ago");
  });

  it("changes nothing by being looked at: only reads are made, and no note is written", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report({ conflicts: [COPY], proposals: 1, index: { notes: 4, unindexed: 2, schema: 1 } }));
    const before = await paths();
    const writes = watchWrites();
    render(<HealthCenter />);
    await screen.findByRole("region", { name: "External changes" });
    // Open the preview of a fix too: still nothing is done.
    fireEvent.click(screen.getByRole("button", { name: /^Preview the fix/ }));
    expect(screen.getByRole("group", { name: "What the fix would do" })).toBeTruthy();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(await paths()).toEqual(before);
  });

  it("previews trashing a conflict copy, does it only on 'Do it', and leaves the page", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report({ conflicts: [COPY] }));
    render(<HealthCenter />);
    fireEvent.click(await screen.findByRole("button", { name: `Preview the fix: ${COPY}` }));
    const preview = screen.getByRole("group", { name: "What the fix would do" });
    expect(preview.textContent).toContain(`Move “${COPY}” to the trash.`);
    expect(preview.textContent).toContain("library/Plan.md");
    expect(await paths()).toContain(COPY);
    await act(async () => fireEvent.click(within(preview).getByRole("button", { name: "Do it" })));
    await waitFor(async () => expect(await paths()).not.toContain(COPY));
    expect(await paths()).toContain("library/Plan.md");
    expect(screen.queryByRole("group", { name: "What the fix would do" })).toBeNull();
  });

  it("cancels a preview without doing anything", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report({ conflicts: [COPY] }));
    render(<HealthCenter />);
    fireEvent.click(await screen.findByRole("button", { name: `Preview the fix: ${COPY}` }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "What the fix would do" })).toBeNull();
    expect(await paths()).toContain(COPY);
  });

  it("opens an issue's file in a tab", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report({ conflicts: [COPY] }));
    render(<HealthCenter />);
    fireEvent.click(await screen.findByRole("button", { name: `Open: ${COPY}` }));
    expect(useWorkspace.getState().layout.panes.flatMap((p) => p.tabs.map((t) => t.place.path))).toContain(COPY);
  });

  it("runs the check only when asked, then lists the problems and offers to make the page a link leads to", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report());
    const found: VerifyReport = { notes: 4, boards: 0, decks: 0, gitObjects: 0, problems: [{ kind: "unresolved-link", path: "projects/trip/pages/plan.md", detail: "[[Hotels]] points to no note" }] };
    const verify = vi.spyOn(vault, "verify").mockResolvedValue(found);
    render(<HealthCenter />);
    await screen.findByRole("region", { name: "References and files" });
    expect(verify).not.toHaveBeenCalled();
    expect(section("References and files").textContent).toContain("not checked yet");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(section("References and files").textContent).toContain("1 problem in 4 notes");
    fireEvent.click(screen.getByRole("button", { name: /^Preview the fix: \[\[Hotels\]\]/ }));
    expect(screen.getByRole("group", { name: "What the fix would do" }).textContent).toContain("empty page called “Hotels”");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Do it" })));
    await waitFor(async () => expect((await vault.list()).find((n) => n.title === "Hotels")?.path.startsWith("projects/trip/")).toBe(true));
  });

  it("goes to Review from the proposals and to the settings that fix a backup", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report({ proposals: 1, backup: { state: "failing", lastPush: 1, failures: 2, lastError: "no route" } }));
    render(<HealthCenter />);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings: Backup and history settings" }));
    expect(useSettingsJump.getState().target).toEqual({ group: "history" });
    fireEvent.click(screen.getByRole("button", { name: "Open Review: Review the proposed changes" }));
    expect(useWorkspace.getState().place.view).toBe("review");
  });

  it("lists a diagram whose picture is out of date, and asks for it to be drawn again only on 'Do it'", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report());
    useDiagrams.setState({ list: [{ path: "library/flow.drawio", title: "Flow", project: null, pages: 1, modified: 1, size: 1, preview: "stale", problem: null }], loaded: true });
    render(<HealthCenter />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview the fix: Flow: the picture is out of date" }));
    expect(screen.getByRole("group", { name: "What the fix would do" }).textContent).toContain("The diagram itself is not changed");
  });

  it("says the editor is needed when it is not installed", async () => {
    vi.spyOn(vault, "vaultHealth").mockResolvedValue(report());
    useDiagramEditor.setState({ info: { version: "32.2.0", bytes: 1, url: "", installed: false, busy: false } });
    useDiagrams.setState({ list: [{ path: "library/flow.drawio", title: "Flow", project: null, pages: 1, modified: 1, size: 1, preview: "missing", problem: null }], loaded: true });
    render(<HealthCenter />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview the fix: Flow: no picture yet" }));
    const preview = screen.getByRole("group", { name: "What the fix would do" });
    expect(preview.textContent).toContain("Install the diagram editor");
    expect((within(preview).getByRole("button", { name: "Do it" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws nothing without a vault", () => {
    useWorkspace.setState({ client: null });
    const { container } = render(<HealthCenter />);
    expect(container.textContent).toBe("");
  });
});
