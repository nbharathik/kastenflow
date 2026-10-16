import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ImportOptions, ImportSummary, Imported, Undone } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { useImportRequest } from "./drop";
import { ImportView } from "./ImportView";

const PLAN: ImportSummary = {
  kind: "obsidian",
  project: "Field notes",
  projectPath: "projects/field-notes/_project.md",
  notes: 8,
  days: 1,
  daysAppended: 1,
  boards: 1,
  files: 3,
  tags: 0,
  warnings: ["1 note had a `type` of its own; it is kept as `note-type`: Travel/Summer trip.md."],
};

/** The preview vault, answering imports as the desktop app would. */
class ImportingVault extends MemoryVault {
  asked: { source: string; options: ImportOptions }[] = [];
  undone: string[] = [];
  conflict = false;

  override async planImport(source: string, options: ImportOptions): Promise<ImportSummary> {
    this.asked.push({ source, options });
    if (source.includes("missing")) throw new Error(`No folder at ${source}`);
    return { ...PLAN, project: options.project ?? PLAN.project };
  }

  override async importNotes(source: string, options: ImportOptions): Promise<Imported> {
    this.asked.push({ source, options });
    await this.create({ kind: "project", title: "Field notes", date: "2026-09-25" });
    return { summary: { ...PLAN, project: options.project ?? PLAN.project }, commit: "c0ffee" };
  }

  override async undoCommit(commit: string): Promise<Undone> {
    this.undone.push(commit);
    if (this.conflict) return { reverted: [], conflict: { commit, summary: "import", path: "projects/field-notes/pages/welcome.md", detail: "It was edited on the same lines after this change" } };
    return { reverted: [commit], conflict: null };
  }
}

let vault: ImportingVault;

async function open() {
  vault = new ImportingVault({});
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<ImportView />);
}

const folder = () => screen.getByRole("textbox", { name: /Folder/ });
const look = () => screen.getByRole("button", { name: "Look at the folder" });

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the Import view", () => {
  it("says how to get a folder out of each tool", async () => {
    await open();
    const kinds = screen.getByRole("radiogroup", { name: "Where the notes are" });
    expect(within(kinds).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Obsidian"),
      expect.stringContaining("Notion"),
      expect.stringContaining("Heptabase"),
      expect.stringContaining("KastenFlow bundle"),
      expect.stringContaining("Markdown folder"),
    ]);
    fireEvent.click(within(kinds).getByRole("radio", { name: /Notion/ }));
    expect(screen.getByRole("list", { name: "Getting the folder from Notion" }).textContent).toContain("Markdown & CSV");
    expect(look()).toHaveProperty("disabled", true);
  });

  it("shows what would come in, imports it, opens it and undoes it", async () => {
    await open();
    fireEvent.change(folder(), { target: { value: "~/Documents/Field notes" } });
    await act(async () => fireEvent.click(look()));
    const plan = await screen.findByRole("region", { name: "What will come in" });
    expect(plan.textContent).toContain("This is an Obsidian vault. It becomes the project “Field notes”");
    expect(within(plan).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "8notes",
      "2journal days1 added to days you have",
      "1boards",
      "3files",
      expect.stringContaining("note-type"),
    ]);
    // Changing the folder puts the plan away: what is imported is what was looked at.
    fireEvent.change(folder(), { target: { value: "~/Documents/Field notes " } });
    expect(screen.queryByRole("region", { name: "What will come in" })).toBeNull();
    await act(async () => fireEvent.click(look()));
    const again = await screen.findByRole("region", { name: "What will come in" });
    await act(async () => fireEvent.click(within(again).getByRole("button", { name: "Import 8 notes, 2 journal days, 1 board and 3 files" })));

    const done = await screen.findByRole("region", { name: "Imported" });
    expect(done.textContent).toContain("Imported 8 notes, 2 journal days, 1 board and 3 files into “Field notes”");
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("Imported 8 notes into “Field notes”");
    expect(useWorkspace.getState().notes.some((n) => n.title === "Field notes")).toBe(true);
    fireEvent.click(within(done).getByRole("button", { name: "Open the project" }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "projects/field-notes/_project.md" });

    await act(async () => fireEvent.click(within(done).getByRole("button", { name: "Undo the import" })));
    expect(vault.undone).toEqual(["c0ffee"]);
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("The import is undone");
    expect(screen.queryByRole("region", { name: "Imported" })).toBeNull();
    expect(vault.asked.at(-1)).toEqual({ source: "~/Documents/Field notes ", options: { project: undefined } });
  });

  it("keeps the folder and project as they were while it looks", async () => {
    await open();
    let answer: () => void = () => {};
    const plan = vault.planImport.bind(vault);
    vault.planImport = async (source, options) => {
      await new Promise<void>((done) => (answer = done));
      return plan(source, options);
    };
    fireEvent.change(folder(), { target: { value: "/notes" } });
    await act(async () => fireEvent.click(look()));
    expect((folder() as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: /Project/ }) as HTMLInputElement).disabled).toBe(true);
    await act(async () => answer());
    expect(await screen.findByRole("region", { name: "What will come in" })).toBeTruthy();
    expect((folder() as HTMLInputElement).disabled).toBe(false);
  });

  it("names the project as asked", async () => {
    await open();
    fireEvent.change(folder(), { target: { value: "/notes" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Project/ }), { target: { value: "Old notes" } });
    await act(async () => fireEvent.click(look()));
    expect((await screen.findByRole("region", { name: "What will come in" })).textContent).toContain("“Old notes”");
    expect(vault.asked.at(-1)!.options).toEqual({ project: "Old notes" });
  });

  it("says what went wrong, and why an undo stopped", async () => {
    await open();
    fireEvent.change(folder(), { target: { value: "/missing" } });
    await act(async () => fireEvent.click(look()));
    expect((await screen.findByRole("alert")).textContent).toBe("No folder at /missing");

    fireEvent.change(folder(), { target: { value: "/notes" } });
    await act(async () => fireEvent.click(look()));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: /^Import 8 notes/ })));
    vault.conflict = true;
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo the import" })));
    expect((await screen.findByRole("alert")).textContent).toContain("projects/field-notes/pages/welcome.md changed since the import");
    expect(screen.getByRole("region", { name: "Imported" })).toBeTruthy();
  });

  it("shows what a bundle settles before it writes, unfolded, and one notice undoes the whole import", async () => {
    await open();
    const bundle: ImportSummary = {
      ...PLAN,
      kind: "bundle",
      project: "Seaside trip",
      warnings: [],
      conflicts: [
        { kind: "project", what: "projects/trip", resolution: "Imported as projects/trip-2: this vault has a project there." },
        { kind: "id", what: "01J8Z3K6Q2M4X7V9B1C5D8E0F2", resolution: "Given a new id: this vault has a note with it." },
        { kind: "asset", what: "assets/map.png", resolution: "Kept as assets/map-2.png: a different file is there." },
        { kind: "tag", what: "place", resolution: "This vault's tag schema is kept." },
        { kind: "key", what: "lecun2015deep", resolution: "Renamed lecun2015deep-2: your bibliography has another entry with it." },
      ],
    };
    vault.planImport = async () => bundle;
    fireEvent.click(screen.getByRole("radio", { name: /KastenFlow bundle/ }));
    expect(screen.getByRole("list", { name: "Getting the folder from KastenFlow bundle" }).textContent).toContain("kastenflow-bundle.json");
    fireEvent.change(folder(), { target: { value: "~/Documents/trip-bundle" } });
    await act(async () => fireEvent.click(look()));
    const plan = await screen.findByRole("region", { name: "What will come in" });
    expect(plan.textContent).toContain("This is a KastenFlow project bundle");
    const known = plan.querySelector("details")!;
    expect(known.open).toBe(true);
    expect(within(known as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "projects/trip: Imported as projects/trip-2: this vault has a project there.",
      "01J8Z3K6Q2M4X7V9B1C5D8E0F2: Given a new id: this vault has a note with it.",
      "assets/map.png: Kept as assets/map-2.png: a different file is there.",
      "place: This vault's tag schema is kept.",
      "lecun2015deep: Renamed lecun2015deep-2: your bibliography has another entry with it.",
    ]);
    // Nothing is written until Import; then one notice with Undo takes the whole import back, and the card stands down.
    expect(vault.undone).toEqual([]);
    await act(async () => fireEvent.click(within(plan).getByRole("button", { name: /^Import 8 notes/ })));
    await screen.findByRole("region", { name: "Imported" });
    const notice = useWorkspace.getState().toasts.at(-1)!;
    expect(notice.action?.label).toBe("Undo");
    await act(async () => void notice.action!.run());
    expect(vault.undone).toEqual(["c0ffee"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Imported" })).toBeNull());
  });

  it("explains that the browser preview cannot read folders", async () => {
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    render(<ImportView />);
    fireEvent.change(folder(), { target: { value: "/notes" } });
    await act(async () => fireEvent.click(look()));
    expect((await screen.findByRole("alert")).textContent).toContain("needs the desktop app");
  });

  it("looks at a dropped folder as soon as it is ready", async () => {
    await open();
    await act(async () => useImportRequest.setState({ source: "/cache/drops/1/Trip" }));
    expect(vault.asked.at(-1)?.source).toBe("/cache/drops/1/Trip");
    expect(folder()).toHaveProperty("value", "/cache/drops/1/Trip");
    expect(await screen.findByRole("region", { name: "What will come in" })).toBeTruthy();
    expect(useImportRequest.getState().source).toBeNull();
  });

  it("offers Browse only in the desktop app", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Browse…" })).toBeNull();
  });
});
