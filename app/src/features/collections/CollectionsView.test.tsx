// Collections as a place: the list on the left, the open one found again
// each time with a preview beside it, notes ticked for actions, a new one
// from an example or the dialog, and the trash with its Undo.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { CollectionsView } from "./CollectionsView";
import { useCollectionRequests } from "./requests";

const SEED = {
  "library/a.md": "---\nid: 01A\ntitle: Alpha\ntags: [reading]\n---\nAlpha body.\n",
  "library/b.md": "---\nid: 01B\ntitle: Beta\ntags: [reading]\n---\nBeta body.\n",
  "library/c.md": "---\nid: 01C\ntitle: Gamma\n---\nGamma body.\n",
};

let vault: MemoryVault;
const toast = vi.fn();
const go = vi.fn();
const openPath = vi.fn();

const hit = (path: string) => ({ path, title: path, icon: null, snippet: "", score: 1 });

async function setup(files: Record<string, string> = {}) {
  vault = new MemoryVault({ ...SEED });
  if (Object.keys(files).length > 0) (vault as unknown as { data: { views: Record<string, string> } }).data.views = files;
  else await vault.createCollection("Reading queue", { query: "tag:reading" });
  vi.spyOn(vault, "search").mockImplementation(async (query: string) => (query.includes("tag:reading") ? [hit("library/a.md"), hit("library/b.md")] : []));
  useWorkspace.setState({ client: vault, notes: await vault.list(), toast, go, openPath });
}

beforeEach(() => {
  localStorage.clear();
  toast.mockClear();
  go.mockClear();
  openPath.mockClear();
  useCollectionRequests.getState().clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const table = () => screen.findByRole("table", { name: "What the collection found" });

describe("the collections place", () => {
  it("lists the collections, opens the first and finds its notes again", async () => {
    await setup();
    render(<CollectionsView />);
    const nav = await screen.findByRole("navigation", { name: "Collections" });
    expect(within(nav).getByRole("button", { name: /Reading queue/ }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("2 notes")).toBeTruthy();
    const rows = within(await table());
    expect(rows.getByText("Alpha")).toBeTruthy();
    expect(rows.getByText("Beta")).toBeTruthy();
    expect(rows.queryByText("Gamma")).toBeNull();
    expect(vault.search).toHaveBeenCalledWith("tag:reading", 5000);
    // Examples are offered until a collection has their name.
    const examples = within(screen.getByRole("region", { name: "Start from an example" }));
    expect(examples.getAllByRole("button").map((b) => b.querySelector("span")?.textContent)).toEqual(["Unprocessed captures", "Captured this week", "Recently changed research", "Experiments needing review"]);
  });

  it("previews the note chosen beside the list, which stays where it is", async () => {
    await setup();
    render(<CollectionsView />);
    const rows = within(await table());
    expect(screen.queryByRole("complementary", { name: "Preview" })).toBeNull();
    fireEvent.click(rows.getByRole("button", { name: "Alpha" }));
    const preview = within(screen.getByRole("complementary", { name: "Preview" }));
    expect(preview.getByRole("heading", { name: "Alpha" })).toBeTruthy();
    expect(preview.getByText("Alpha body.")).toBeTruthy();
    fireEvent.click(rows.getByRole("button", { name: "Beta" }));
    expect(preview.getByRole("heading", { name: "Beta" })).toBeTruthy();
    // The list is still there to carry on from; Open leaves it.
    expect(rows.getByText("Alpha")).toBeTruthy();
    fireEvent.click(preview.getByRole("button", { name: "Open" }));
    expect(openPath).toHaveBeenCalledWith("library/b.md", "here");
    fireEvent.click(preview.getByRole("button", { name: "Close the preview" }));
    expect(screen.queryByRole("complementary", { name: "Preview" })).toBeNull();
  });

  it("moves the preview with the arrow keys and ticks with Space", async () => {
    await setup();
    render(<CollectionsView />);
    const list = await table();
    fireEvent.click(within(list).getByRole("button", { name: "Alpha" }));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(within(screen.getByRole("complementary", { name: "Preview" })).getByRole("heading", { name: "Beta" })).toBeTruthy();
    fireEvent.keyDown(list, { key: " " });
    expect(screen.getByRole("toolbar", { name: "Notes ticked" }).textContent).toContain("1 ticked");
  });

  it("offers the actions on the ticked notes", async () => {
    await setup();
    render(<CollectionsView />);
    const rows = within(await table());
    expect(screen.queryByRole("toolbar", { name: "Notes ticked" })).toBeNull();
    fireEvent.click(rows.getByRole("checkbox", { name: "Pick Alpha" }));
    fireEvent.click(rows.getByRole("checkbox", { name: "Pick Beta" }));
    const bar = within(screen.getByRole("toolbar", { name: "Notes ticked" }));
    expect(bar.getByText("2 ticked")).toBeTruthy();
    expect(bar.getAllByRole("button").map((b) => b.textContent)).toEqual(["Open in tabs", "Add to board…", "Add to AI context", "Clear"]);
    fireEvent.click(bar.getByRole("button", { name: "Open in tabs" }));
    expect(openPath.mock.calls).toEqual([
      ["library/a.md", "tab"],
      ["library/b.md", "tab"],
    ]);
    fireEvent.click(bar.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("toolbar", { name: "Notes ticked" })).toBeNull();
  });

  it("starts from an example, which is then an ordinary collection that opens", async () => {
    await setup();
    render(<CollectionsView />);
    await table();
    const create = vi.spyOn(vault, "createCollection");
    fireEvent.click(within(screen.getByRole("region", { name: "Start from an example" })).getByRole("button", { name: /Unprocessed captures/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith({ view: "collections", path: "views/unprocessed-captures.yaml" }));
    expect(create).toHaveBeenCalledWith("Unprocessed captures", expect.objectContaining({ query: "#capture" }));
    expect((await vault.collections()).map((c) => c.name)).toEqual(["Reading queue", "Unprocessed captures"]);
  });

  it("says what a collection is for when there are none, and starts one from the dialog", async () => {
    vault = new MemoryVault({ ...SEED });
    vi.spyOn(vault, "search").mockResolvedValue([]);
    useWorkspace.setState({ client: vault, notes: await vault.list(), toast, go, openPath });
    render(<CollectionsView />);
    expect(await screen.findByRole("heading", { name: "Keep a search" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Save as collection" })).toBeTruthy();
    const save = dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Everything" } });
    fireEvent.click(save);
    await waitFor(() => expect(go).toHaveBeenCalledWith({ view: "collections", path: "views/everything.yaml" }));
    expect(toast).toHaveBeenCalledWith("Saved the collection “Everything”", expect.objectContaining({ label: "Open" }));
    expect((await vault.collections()).map((c) => c.name)).toEqual(["Everything"]);
  });

  it("opens the dialog already filled in for a search kept from elsewhere", async () => {
    await setup();
    useCollectionRequests.getState().ask({ edits: { query: "tag:paper", when: { updated: "last-7-days" } }, name: "tag:paper", dropped: ["sort by relevance"] });
    render(<CollectionsView />);
    const dialog = within(await screen.findByRole("dialog"));
    expect((dialog.getByLabelText("Name") as HTMLInputElement).value).toBe("tag:paper");
    expect(dialog.getByText("tag:paper", { selector: "code" })).toBeTruthy();
    expect(dialog.getByText(/Not kept, since a collection cannot say it: sort by relevance/)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(useCollectionRequests.getState().pending).toBeNull();
  });

  it("says a collection is gone when its path is, and offers the list", async () => {
    await setup();
    render(<CollectionsView path="views/gone.yaml" />);
    expect(await screen.findByText("That collection is not here any more.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See the collections" }));
    expect(go).toHaveBeenCalledWith({ view: "collections" });
  });

  it("asks before moving a collection to the trash, and Undo brings it back", async () => {
    await setup();
    render(<CollectionsView />);
    await table();
    fireEvent.click(screen.getByRole("button", { name: "More about this collection" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to trash" }));
    const dialog = within(screen.getByRole("dialog", { name: "Move this collection to the trash?" }));
    expect(dialog.getByText(/Your notes are not touched/)).toBeTruthy();
    // Nothing happened yet.
    expect((await vault.collections()).map((c) => c.name)).toEqual(["Reading queue"]);
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Move to trash" })));
    await waitFor(async () => expect(await vault.collections()).toEqual([]));
    expect(go).toHaveBeenCalledWith({ view: "collections" });
    const [text, action] = toast.mock.calls.at(-1) as [string, { label: string; run(): void }];
    expect(text).toBe("Moved the collection “Reading queue” to the trash");
    expect(action.label).toBe("Undo");
    act(() => action.run());
    await waitFor(async () => expect((await vault.collections()).map((c) => c.name)).toEqual(["Reading queue"]));
    expect(go).toHaveBeenCalledWith({ view: "collections", path: "views/reading-queue.yaml" });
  });

  it("shows a collection it cannot use with the reason, and does not let it be edited", async () => {
    await setup({ "views/future.yaml": "format: 2\nname: From the future\nquery: tag:x\n" });
    render(<CollectionsView />);
    const nav = await screen.findByRole("navigation", { name: "Collections" });
    expect(within(nav).getByText("Cannot be used")).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/This collection cannot be used/);
    expect(alert.textContent).toMatch(/Its file is left as it is/);
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(vault.search).not.toHaveBeenCalled();
  });
});
