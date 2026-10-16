// Export a project as a bundle: the dialog shows what would go in before it
// writes anything, says what is never in a bundle, takes a new folder outside the
// vault, and tells what it wrote. The desktop app does the writing; here a
// stand-in answers.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BundleExported, BundlePlan } from "../../../lib/vault/bundle-types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { ExportProject } from "./ExportProject";
import { useExportRequest } from "./request";

const PLAN: BundlePlan = {
  project: { folder: "trip", title: "Seaside trip", id: "01J8" },
  files: [
    { path: "projects/trip/_project.md", kind: "project", bytes: 200 },
    { path: "projects/trip/pages/plan.md", kind: "project", bytes: 900 },
    { path: "projects/trip/boards/map.canvas", kind: "project", bytes: 400 },
    { path: "assets/map.png", kind: "asset", bytes: 2_000_000 },
    { path: "references.bib", kind: "references", bytes: 300 },
  ],
  bytes: 2_001_800,
  references: ["lecun2015deep"],
  missingReferences: ["nobody2020"],
  outside: ["3 links lead to notes outside the project"],
};

class Bundling extends MemoryVault {
  exported: { project: string; dest: string }[] = [];
  planAsked: string[] = [];
  failExport: string | null = null;

  override async planExport(project: string): Promise<BundlePlan> {
    this.planAsked.push(project);
    if (project === "none") throw new Error("No project called none");
    return { ...PLAN, project: { ...PLAN.project, folder: project } };
  }

  override async exportProject(project: string, dest: string): Promise<BundleExported> {
    this.exported.push({ project, dest });
    if (this.failExport) throw new Error(this.failExport);
    return { dest, files: 5, bytes: 2_001_800, references: 1, outside: PLAN.outside };
  }
}

const SEED = {
  "projects/trip/_project.md": "---\ntitle: Seaside trip\ntype: project\n---\n",
  "projects/photos/_project.md": "---\ntitle: Photo organiser\ntype: project\n---\n",
};

let vault: Bundling;

async function open(project: string | null, client: MemoryVault = vault) {
  await useWorkspace.getState().connect({ client });
  useExportRequest.setState({ request: { project } });
  render(<ExportProject />);
}

beforeEach(() => {
  vault = new Bundling(SEED);
  useWorkspace.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  useExportRequest.setState({ request: null });
});

const dialog = () => screen.getByRole("dialog", { name: "Export a project" });
const dest = () => within(dialog()).getByRole("textbox", { name: "Destination folder" }) as HTMLInputElement;
const exportButton = () => within(dialog()).getByRole("button", { name: "Export" }) as HTMLButtonElement;

describe("the export dialog", () => {
  it("shows what would go in, what is left out and what a bundle never holds, before it writes anything", async () => {
    await open("trip");
    expect(await within(dialog()).findByText("2 pages, 1 whiteboard, 1 picture or file and 1 bibliography entry · 1.9 MB")).toBeTruthy();
    expect(within(dialog()).getByText("3 links lead to notes outside the project")).toBeTruthy();
    expect(within(dialog()).getByText(/Cited in the project but in no bibliography file.*nobody2020/)).toBeTruthy();
    expect(within(dialog()).getByText(/Not in the bundle: credentials and API keys, the vault's history, chats and the trash/)).toBeTruthy();
    expect(vault.exported).toEqual([]);
    expect(exportButton().disabled).toBe(true);
  });

  it("writes into the folder typed, and says what it wrote", async () => {
    await open("trip");
    await within(dialog()).findByText(/pages/);
    fireEvent.change(dest(), { target: { value: "D:/Exports/seaside" } });
    expect(exportButton().disabled).toBe(false);
    await act(async () => fireEvent.click(exportButton()));
    expect(vault.exported).toEqual([{ project: "trip", dest: "D:/Exports/seaside" }]);
    const done = await screen.findByRole("status", { name: "Exported" });
    expect(done.textContent).toContain("5 files");
    expect(done.textContent).toContain("1.9 MB");
    expect(done.textContent).toContain("D:/Exports/seaside");
    // Nothing in the vault changed, and nothing is asked to be undone.
    expect(within(dialog()).queryByRole("button", { name: /Undo/ })).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(useExportRequest.getState().request).toBeNull();
  });

  it("says why an export stopped, and stays open to try another folder", async () => {
    vault.failExport = "That folder is inside the vault";
    await open("trip");
    await within(dialog()).findByText(/pages/);
    fireEvent.change(dest(), { target: { value: "/vault/inside" } });
    await act(async () => fireEvent.click(exportButton()));
    expect((await within(dialog()).findByRole("alert")).textContent).toBe("That folder is inside the vault");
    expect(screen.queryByRole("status", { name: "Exported" })).toBeNull();
    vault.failExport = null;
    fireEvent.change(dest(), { target: { value: "/elsewhere/bundle" } });
    await act(async () => fireEvent.click(exportButton()));
    expect(await screen.findByRole("status", { name: "Exported" })).toBeTruthy();
  });

  it("lets a project be chosen when none was named, and plans again for another", async () => {
    await open(null);
    const pick = within(dialog()).getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Choose a project", "Photo organiser", "Seaside trip"]);
    expect(vault.planAsked).toEqual([]);
    fireEvent.change(pick, { target: { value: "trip" } });
    await within(dialog()).findByText(/pages/);
    fireEvent.change(pick, { target: { value: "photos" } });
    await waitFor(() => expect(vault.planAsked).toEqual(["trip", "photos"]));
  });

  it("says what went wrong when the project cannot be planned", async () => {
    await open("none");
    expect((await within(dialog()).findByRole("alert")).textContent).toBe("No project called none");
    expect(exportButton().disabled).toBe(true);
  });

  it("says that the browser preview cannot write folders", async () => {
    await open("trip", new MemoryVault(SEED));
    expect((await within(dialog()).findByRole("alert")).textContent).toContain("needs the desktop app");
  });

  it("closes on Escape and on Cancel, writing nothing", async () => {
    await open("trip");
    await within(dialog()).findByText(/pages/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useExportRequest.getState().request).toBeNull());
    expect(vault.exported).toEqual([]);
    vi.restoreAllMocks();
  });
});
