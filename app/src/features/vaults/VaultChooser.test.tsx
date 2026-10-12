import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  vaultChoices: vi.fn(),
  openVault: vi.fn(),
  browseFolders: vi.fn(),
  surveyFolder: vi.fn(),
  folderSynced: vi.fn(),
  listKits: vi.fn(),
}));

import * as api from "../../lib/api";
import { VaultChooser } from "./VaultChooser";

const PLACES = [
  { label: "Home", path: "/home/a" },
  { label: "Documents", path: "/home/a/Documents" },
];
const LISTINGS: Record<string, api.FolderListing> = {
  "/home/a/Documents": {
    path: "/home/a/Documents",
    parent: "/home/a",
    places: PLACES,
    folders: [
      { name: "Notes", path: "/home/a/Documents/Notes", kind: "obsidian" },
      { name: "Work", path: "/home/a/Documents/Work", kind: "kasten" },
    ],
  },
  "/home/a/Documents/Notes": { path: "/home/a/Documents/Notes", parent: "/home/a/Documents", places: PLACES, folders: [] },
};
const SURVEYS: Record<string, api.FolderSurvey> = {
  "/home/a/Documents/Notes": { kasten: null, obsidian: true, notes: 214, more: false, folders: ["Areas", "Daily"] },
  "/home/a/Documents/Work": { kasten: { name: "Work notes", format: 1, readable: true }, obsidian: false, notes: 40, more: false, folders: ["projects"] },
  "/home/a/Documents/Future": { kasten: { name: "Future", format: 2, readable: false }, obsidian: false, notes: 3, more: false, folders: [] },
};

const value = (el: HTMLElement) => (el as HTMLInputElement).value;

beforeEach(() => {
  vi.mocked(api.vaultChoices).mockResolvedValue({ current: null, recent: [], suggested: "/home/a/Documents/Kasten", fromEnv: false });
  vi.mocked(api.browseFolders).mockImplementation(async (path) => {
    const found = LISTINGS[path ?? "/home/a/Documents"];
    if (!found) throw new Error(`Can't read ${path}`);
    return found;
  });
  vi.mocked(api.surveyFolder).mockImplementation(async (path) => {
    const found = SURVEYS[path];
    if (!found) throw new Error(`No folder at ${path}`);
    return found;
  });
  vi.mocked(api.openVault).mockResolvedValue();
  vi.mocked(api.listKits).mockResolvedValue([
    { id: "daily-planner", icon: "🌤️", name: "Daily planner and journal", summary: "Plan each day.", home: "library/daily-planner.md", recommended: true, files: [] },
    { id: "gtd", icon: "✅", name: "Getting Things Done", summary: "Next actions.", home: "library/getting-things-done.md", recommended: false, files: [] },
  ]);
  vi.mocked(api.folderSynced).mockImplementation(async (path) => (path.includes("/OneDrive/") ? "OneDrive" : null));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Choosing the vault", () => {
  it("makes a new vault in a folder picked in the browser", async () => {
    render(<VaultChooser />);
    const create = await screen.findByRole("region", { name: "Create a new vault" });
    await waitFor(() => expect(value(within(create).getByLabelText("Location"))).toBe("/home/a/Documents"));
    fireEvent.change(within(create).getByLabelText("Name"), { target: { value: "My notes" } });
    expect(within(create).getByText("/home/a/Documents/My notes")).toBeTruthy();

    fireEvent.click(within(create).getByRole("button", { name: "Browse…" }));
    const picker = await screen.findByRole("dialog", { name: "Where to make the vault" });
    const folders = within(picker).getByRole("list", { name: "Folders" });
    expect(await within(folders).findByText("Obsidian vault")).toBeTruthy();
    expect(within(folders).getByText("KastenFlow vault")).toBeTruthy();
    // Into a folder and back up.
    await act(async () => fireEvent.doubleClick(within(folders).getByRole("button", { name: /^Notes/ })));
    expect(await within(picker).findByText("No folders here")).toBeTruthy();
    await act(async () => fireEvent.click(within(picker).getByRole("button", { name: "Up one folder" })));
    // Pick a folder: the vault is made inside it.
    fireEvent.click(await within(picker).findByRole("button", { name: /^Notes/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Make it in “Notes”" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(value(within(create).getByLabelText("Location"))).toBe("/home/a/Documents/Notes");
    await act(async () => fireEvent.click(within(create).getByRole("button", { name: "Create vault" })));
    // The recommended kit is picked unless another choice is made.
    expect(api.openVault).toHaveBeenCalledWith("/home/a/Documents/Notes/My notes", true, "My notes", "daily-planner");
  });

  it("starts a new vault with the kit picked, or blank, and opens the kit's page after", async () => {
    localStorage.clear();
    render(<VaultChooser />);
    const create = await screen.findByRole("region", { name: "Create a new vault" });
    await waitFor(() => expect(value(within(create).getByLabelText("Location"))).toBe("/home/a/Documents"));
    const recommended = await within(create).findByRole("radio", { name: /Daily planner and journal/ });
    expect((recommended as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(create).getByRole("radio", { name: /Getting Things Done/ }));
    expect(within(create).getByText(/Next actions\./)).toBeTruthy();
    await act(async () => fireEvent.click(within(create).getByRole("button", { name: "Create vault" })));
    expect(api.openVault).toHaveBeenLastCalledWith("/home/a/Documents/Kasten", true, "Kasten", "gtd");
    expect(localStorage.getItem("kasten.first-page")).toBe("library/getting-things-done.md");
  });

  it("starts a blank vault when asked", async () => {
    localStorage.clear();
    render(<VaultChooser />);
    const create = await screen.findByRole("region", { name: "Create a new vault" });
    await waitFor(() => expect(value(within(create).getByLabelText("Location"))).toBe("/home/a/Documents"));
    fireEvent.click(await within(create).findByRole("radio", { name: /Blank/ }));
    expect(within(create).getByText(/Just the templates/)).toBeTruthy();
    await act(async () => fireEvent.click(within(create).getByRole("button", { name: "Create vault" })));
    expect(api.openVault).toHaveBeenLastCalledWith("/home/a/Documents/Kasten", true, "Kasten", undefined);
    expect(localStorage.getItem("kasten.first-page")).toBeNull();
  });

  it("says what a folder holds before it is opened", async () => {
    // The survey waits a moment after typing stops (FolderNote.tsx), which
    // a busy machine can stretch past findBy's usual second.
    const SURVEYED = { timeout: 10_000 };
    render(<VaultChooser />);
    const open = await screen.findByRole("region", { name: "Open a folder" });
    const folder = within(open).getByLabelText("Folder");
    // The field is the same element once the folders load and Browse… comes.
    await within(open).findByRole("button", { name: "Browse…" });
    expect(within(open).getByLabelText("Folder")).toBe(folder);

    fireEvent.change(folder, { target: { value: "/home/a/Documents/Notes" } });
    expect(await within(open).findByText(/An Obsidian vault: 214 notes in 2 folders\. It opens as it is: its folders stay folders/, {}, SURVEYED)).toBeTruthy();

    // A vault from a newer Kasten is not opened.
    fireEvent.change(folder, { target: { value: "/home/a/Documents/Future" } });
    expect(await within(open).findByText(/made by a newer version of KastenFlow/, {}, SURVEYED)).toBeTruthy();
    expect((within(open).getByRole("button", { name: "Open folder" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(folder, { target: { value: "/nowhere" } });
    expect(await within(open).findByText("No folder at /nowhere", {}, SURVEYED)).toBeTruthy();

    // A Kasten vault opens as it is; the app restarts on it.
    fireEvent.change(folder, { target: { value: "/home/a/Documents/Work" } });
    expect(await within(open).findByText("Work notes", {}, SURVEYED)).toBeTruthy();
    await act(async () => fireEvent.click(within(open).getByRole("button", { name: "Open vault" })));
    expect(api.openVault).toHaveBeenCalledWith("/home/a/Documents/Work", false, undefined, undefined);
  });

  it("warns before a vault goes in a folder a sync app copies", async () => {
    const CHECKED = { timeout: 10_000 };
    render(<VaultChooser />);
    const create = await screen.findByRole("region", { name: "Create a new vault" });
    await waitFor(() => expect(value(within(create).getByLabelText("Location"))).toBe("/home/a/Documents"));
    fireEvent.change(within(create).getByLabelText("Location"), { target: { value: "/home/a/OneDrive/Documents" } });
    expect(await within(create).findByText(/This folder is inside OneDrive, which copies files while KastenFlow writes them/, {}, CHECKED)).toBeTruthy();
    // Out of it, the warning goes; a vault can still be made there if wanted.
    fireEvent.change(within(create).getByLabelText("Location"), { target: { value: "/home/a/Notes" } });
    await waitFor(() => expect(within(create).queryByText(/inside OneDrive/)).toBeNull(), CHECKED);

    const open = screen.getByRole("region", { name: "Open a folder" });
    fireEvent.change(within(open).getByLabelText("Folder"), { target: { value: "/home/a/OneDrive/Obsidian" } });
    expect(await within(open).findByText(/inside OneDrive/, {}, CHECKED)).toBeTruthy();
  });
});
