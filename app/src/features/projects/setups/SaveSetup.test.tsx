// "Save as a setup": one dialog with a name and a checklist of what will be kept.
// The pages directly under the project's pages folder start ticked, the rest of
// what comes along is told before anything is written, a refusal stays beside the
// fields, and saving is one notice that offers Undo. The preview vault stands in
// for the core.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { SaveSetup, alsoKept } from "./SaveSetup";
import { saveCurrentProjectAsSetup, useSaveSetupRequest } from "./request";

const SEED = {
  "projects/trip/_project.md": "---\ntitle: Seaside trip\ntype: project\nicon: 🌊\nprops:\n  summary: Plan\n---\n",
  "projects/trip/pages/plan.md": "---\ntitle: Plan\ntype: page\ntags: [paper]\n---\nSeaside trip plan.\n",
  "projects/trip/pages/packing.md": "---\ntitle: Packing\ntype: page\n---\nSocks.\n",
  "projects/trip/pages/ideas/deep.md": "---\ntitle: Deep ideas\ntype: page\n---\nx\n",
  "projects/photos/_project.md": "---\ntitle: Photo organiser\ntype: project\n---\n",
  "tags/paper.yaml": "name: paper\ncolor: blue\nviews:\n  - {name: All, type: table}\n",
};

let vault: MemoryVault;

async function open(project: string | null) {
  await useWorkspace.getState().connect({ client: vault });
  useSaveSetupRequest.setState({ request: { project } });
  render(<SaveSetup />);
}

beforeEach(() => {
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  useSaveSetupRequest.setState({ request: null });
  vi.restoreAllMocks();
});

const dialog = () => screen.getByRole("dialog", { name: "Save as a setup" });
const nameField = () => within(dialog()).getByRole("textbox", { name: "Setup name" }) as HTMLInputElement;
const save = () => within(dialog()).getByRole("button", { name: "Save setup" }) as HTMLButtonElement;
const box = (title: string) => within(dialog()).getByRole("checkbox", { name: new RegExp(`^${title}`) }) as HTMLInputElement;
const toasts = () => useWorkspace.getState().toasts;

describe("the Save as a setup dialog", () => {
  it("lists the pages with those under pages/ ticked, names a setup after the project and tells what else is kept", async () => {
    await open("trip");
    await within(dialog()).findByRole("checkbox", { name: "Plan" });
    expect(box("Plan").checked).toBe(true);
    expect(box("Packing").checked).toBe(true);
    expect(box("Deep ideas").checked).toBe(false);
    expect(within(dialog()).getByText("in a folder")).toBeTruthy();
    expect(within(dialog()).getByText("2 pages kept")).toBeTruthy();
    expect(nameField().value).toBe("Seaside trip setup");
    expect(document.activeElement).toBe(nameField());
    expect(within(dialog()).getByText("Also kept: the properties and views of #paper and the default property summary.")).toBeTruthy();
    // No project chooser when the project is known, and nothing is written yet.
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect((await vault.listSetups()).filter((s) => s.saved)).toEqual([]);
  });

  it("saves the ticked pages in one step and says so with an Undo", async () => {
    await open("trip");
    await within(dialog()).findByRole("checkbox", { name: "Plan" });
    fireEvent.click(box("Packing"));
    fireEvent.click(box("Deep ideas"));
    fireEvent.change(nameField(), { target: { value: "Trip kit" } });
    const saved = vi.spyOn(vault, "saveProjectSetup");
    const undo = vi.spyOn(vault, "undoCommit").mockResolvedValue(undefined as never);
    saved.mockResolvedValueOnce({ id: "saved:trip-kit", slug: "trip-kit", name: "Trip kit", written: [], commit: "c1" });
    fireEvent.click(save());
    await waitFor(() => expect(useSaveSetupRequest.getState().request).toBeNull());
    expect(saved).toHaveBeenCalledWith("trip", "Trip kit", ["projects/trip/pages/ideas/deep.md", "projects/trip/pages/plan.md"]);
    expect(toasts().at(-1)?.text).toBe("Saved the setup “Trip kit”. Choose it when you start a new project.");
    toasts().at(-1)!.action!.run();
    await waitFor(() => expect(undo).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(toasts().at(-1)?.text).toBe("Took the setup “Trip kit” back"));
  });

  it("keeps what the setup holds: the pages ticked, their skeletons and the tag, in the preview vault", async () => {
    await open("trip");
    await within(dialog()).findByRole("checkbox", { name: "Plan" });
    fireEvent.click(box("Packing"));
    fireEvent.submit(nameField().closest("form")!);
    await waitFor(() => expect(useSaveSetupRequest.getState().request).toBeNull());
    const mine = (await vault.listSetups()).filter((s) => s.saved);
    expect(mine).toMatchObject([{ id: "saved:seaside-trip-setup", name: "Seaside trip setup", files: ["pages/plan.md"], tags: ["paper"] }]);
    // The preview has no history, so there is nothing to undo.
    expect(toasts().at(-1)?.action).toBeUndefined();
  });

  it("ticks and unticks them all", async () => {
    await open("trip");
    await within(dialog()).findByRole("checkbox", { name: "Plan" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Untick all" }));
    expect(within(dialog()).getByText("0 pages kept")).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Tick all" }));
    expect(within(dialog()).getByText("3 pages kept")).toBeTruthy();
  });

  it("stays open and says why when the core refuses, with everything typed still there", async () => {
    await open("trip");
    await within(dialog()).findByRole("checkbox", { name: "Plan" });
    vi.spyOn(vault, "saveProjectSetup").mockRejectedValueOnce(new Error("“Plan” is locked"));
    fireEvent.change(nameField(), { target: { value: "My kit" } });
    fireEvent.click(save());
    expect(await within(dialog()).findByRole("alert")).toHaveProperty("textContent", "“Plan” is locked");
    expect(useSaveSetupRequest.getState().request).not.toBeNull();
    expect(nameField().value).toBe("My kit");
    expect(save().disabled).toBe(false);
  });

  it("asks which project when none is meant, and a project with no pages still saves its tags and properties", async () => {
    await open(null);
    expect(save().disabled).toBe(true);
    const choose = within(dialog()).getByRole("combobox", { name: "Project" });
    expect(within(choose).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a project", "Photo organiser", "Seaside trip"]);
    fireEvent.change(choose, { target: { value: "photos" } });
    expect(await within(dialog()).findByText(/has no pages to keep/)).toBeTruthy();
    await waitFor(() => expect(nameField().value).toBe("Photo organiser setup"));
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(useSaveSetupRequest.getState().request).toBeNull());
    expect((await vault.listSetups()).filter((s) => s.saved).map((s) => s.name)).toEqual(["Photo organiser setup"]);
  });

  it("says when the project cannot be read, and keeps Save off", async () => {
    await open("nowhere");
    expect(await within(dialog()).findByRole("alert")).toHaveProperty("textContent", "There is no project called “nowhere”");
    expect(save().disabled).toBe(true);
  });

  it("leaves on Escape and Cancel without saving", async () => {
    await open("trip");
    await within(dialog()).findByRole("checkbox", { name: "Plan" });
    const saved = vi.spyOn(vault, "saveProjectSetup");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(useSaveSetupRequest.getState().request).toBeNull();
    useSaveSetupRequest.setState({ request: { project: "trip" } });
    await screen.findByRole("dialog", { name: "Save as a setup" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useSaveSetupRequest.getState().request).toBeNull());
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("asking for the dialog", () => {
  it("is on the project of where the person is, else it asks which", async () => {
    await useWorkspace.getState().connect({ client: vault });
    useWorkspace.getState().openPath("projects/trip/pages/plan.md");
    saveCurrentProjectAsSetup();
    expect(useSaveSetupRequest.getState().request).toEqual({ project: "trip" });
    useSaveSetupRequest.setState({ request: null });
    useWorkspace.getState().go({ view: "home" });
    saveCurrentProjectAsSetup();
    expect(useSaveSetupRequest.getState().request).toEqual({ project: null });
  });

  it("says what comes along in a sentence, and nothing when nothing does", () => {
    expect(alsoKept({ folder: "a", title: "A", pages: [], tags: ["paper", "task"], props: [] })).toBe("Also kept: the properties and views of #paper, #task.");
    expect(alsoKept({ folder: "a", title: "A", pages: [], tags: [], props: ["summary", "area"] })).toBe("Also kept: the default properties summary, area.");
    expect(alsoKept({ folder: "a", title: "A", pages: [], tags: [], props: [] })).toBe("");
  });
});
