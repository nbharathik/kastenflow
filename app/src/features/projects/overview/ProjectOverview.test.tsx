import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBoards } from "../../boards/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { currentProject, openCurrentOverview, overviewPlace } from "./open";
import { readOverview } from "./overview";
import { ProjectOverview } from "./ProjectOverview";

const PROJECT = "projects/trip/_project.md";
const SEED = {
  [PROJECT]: "---\ntitle: Trip\ntype: project\n---\nA trip.\n",
  "projects/trip/pages/plan.md": "---\ntitle: Plan\ntags: [paper]\n---\nRoute and dates.\n",
  "projects/trip/cards/idea.md": "---\ntitle: Idea\ntype: card\ntags: [capture]\n---\nA thought.\n",
  "inbox/loose.md": "---\ntitle: Loose\ntype: card\ntags: [capture]\n---\nCaught on the way.\n",
  "projects/trip/boards/map.canvas": JSON.stringify({ nodes: [], edges: [], "x-kasten": { title: "Route map" } }),
};

let vault: MemoryVault;
const state = () => useWorkspace.getState();
const tab = (name: string | RegExp) => screen.getByRole("tab", { name });
const projectText = async () => (await vault.read(PROJECT)).text;

async function open() {
  render(<ProjectOverview path={PROJECT} />);
  await screen.findByRole("tablist", { name: "Overview" });
}

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: vault });
  await useBoards.getState().load();
});
afterEach(cleanup);

describe("the project overview", () => {
  it("lists the project's pages, cards and whiteboards on the All tab, not its own page or other projects", async () => {
    await open();
    expect(tab(/^All/).getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    for (const title of ["Plan", "Idea", "Route map"]) expect(within(panel).getByRole("button", { name: new RegExp(title) })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Loose/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Trip/ })).toBeNull();
    expect(panel.textContent).toContain("3 things");
    // One capture is filed in the project and one waits in the inbox.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All3", "Captures2", "Tasks", "Graph"]);
  });

  it("shows the project's status and health in its header and changes them from a menu, through the core", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Project status: Active" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Status: Paused" }));
    await screen.findByRole("button", { name: "Project status: Paused" });
    expect(await projectText()).toContain("status: Paused");
    fireEvent.click(screen.getByRole("button", { name: "Project status: Paused" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Health: Blocked" }));
    await screen.findByRole("button", { name: "Project status: Paused, Blocked" });
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(await projectText()).toContain("health: Blocked");
  });

  it("narrows the All tab by type and by what is typed", async () => {
    await open();
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(within(panel).getByRole("button", { name: "Cards" }));
    expect(within(panel).queryByRole("button", { name: /Plan/ })).toBeNull();
    expect(within(panel).getByRole("button", { name: /Idea/ })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "All" }));
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Find in this project" }), { target: { value: "route tag:paper" } });
    await waitFor(() => expect(within(panel).queryByRole("button", { name: /Idea/ })).toBeNull());
    expect(within(panel).getByRole("button", { name: /Plan/ })).toBeTruthy();
    expect(panel.textContent).toContain("1 of 3");
  });

  it("opens a page from the list with the pane's rules", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: /Idea/ }), { ctrlKey: true });
    expect(state().place.path).toBe("projects/trip/cards/idea.md");
  });

  it("shows captures, and files one that has no project here", async () => {
    await open();
    fireEvent.click(tab(/^Captures/));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("region", { name: "In this project" }).textContent).toContain("Idea");
    const unfiled = within(panel).getByRole("region", { name: "Not filed yet" });
    expect(unfiled.textContent).toContain("Loose");
    fireEvent.click(within(unfiled).getByRole("button", { name: "File Loose in Trip" }));
    await waitFor(() => expect(state().notes.find((n) => n.title === "Loose")?.project).toBe("trip"));
    expect(state().notes.find((n) => n.title === "Loose")!.path.startsWith("projects/trip/")).toBe(true);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Not filed yet" })).toBeNull());
  });

  it("says what captures are until there are some", async () => {
    vault = new MemoryVault({ [PROJECT]: SEED[PROJECT] });
    await state().connect({ client: vault });
    await open();
    fireEvent.click(tab(/^Captures/));
    expect(screen.getByRole("tabpanel").textContent).toContain("No captures yet");
  });

  it("keeps the tab it was on, per project", async () => {
    await open();
    fireEvent.click(tab("Tasks"));
    cleanup();
    await open();
    expect(tab("Tasks").getAttribute("aria-selected")).toBe("true");
  });

  it("says when the project is not there", async () => {
    render(<ProjectOverview path="projects/gone/_project.md" />);
    expect(await screen.findByText(/could not be found/)).toBeTruthy();
  });
});

describe("the header", () => {
  it("has icons with a name and a tooltip, not words, for New, the project page and New table", async () => {
    await open();
    for (const [name, title] of [
      ["New in this project", "New page, card, whiteboard or deck"],
      ["Project page", "Open the project page"],
      ["New table", "New table: a saved view of this project's notes"],
    ] as const) {
      const button = screen.getByRole("button", { name });
      expect(button.textContent, name).toBe("");
      expect(button.title, name).toBe(title);
    }
  });
});

describe("saved tables", () => {
  const makeTable = async (preset: string) => {
    fireEvent.click(screen.getByRole("button", { name: "New table" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: preset }));
  };

  it("are made from a preset, drawn as a table and kept in the project page's overview property", async () => {
    await open();
    await makeTable("Cards only");
    expect(await screen.findByRole("tab", { name: "Cards" })).toBeTruthy();
    expect(tab("Cards").getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(await within(panel).findByRole("grid", { name: "Cards in Trip" })).toBeTruthy();
    expect(within(panel).getByText("Type is card")).toBeTruthy();
    await waitFor(async () => expect(await projectText()).toContain("overview:"));
    const saved = await vault.read(PROJECT);
    const tables = readOverview(saved.meta.props).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ name: "Cards", type: "table", scope: "project", filter: [{ key: "type", op: "is", value: "card" }] });
    // Only the property changed: the rest of the page is as it was.
    expect(saved.text).toContain("A trip.");
  });

  it("are still there when the overview is opened again, and after the window's own memory is gone", async () => {
    await open();
    await makeTable("Pages only");
    await waitFor(async () => expect(await projectText()).toContain("Pages"));
    cleanup();
    localStorage.clear();
    await open();
    expect(await screen.findByRole("tab", { name: "Pages" })).toBeTruthy();
  });

  it("take a filter from the bar and save it", async () => {
    await open();
    await makeTable("Blank table");
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(await within(panel).findByRole("button", { name: "+ Filter" }));
    fireEvent.change(screen.getByLabelText("Property"), { target: { value: "tags" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "contains" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "paper" } });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await waitFor(async () => expect(await projectText()).toContain("paper"));
    expect(readOverview((await vault.read(PROJECT)).meta.props).tables[0]!.filter).toEqual([{ key: "tags", op: "contains", value: "paper" }]);
    expect(within(panel).getByText("Tags contains paper")).toBeTruthy();
  });

  it("can be renamed and duplicated, and deleted with an Undo", async () => {
    await open();
    await makeTable("Blank table");
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(await within(panel).findByRole("button", { name: "Rename Table" }));
    const field = screen.getByLabelText("Table name");
    fireEvent.change(field, { target: { value: "Reading" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByRole("tab", { name: "Reading" });
    expect(tab("Reading").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Duplicate Reading" }));
    await screen.findByRole("tab", { name: "Reading copy" });
    await waitFor(async () => expect(readOverview((await vault.read(PROJECT)).meta.props).tables.map((t) => t.name)).toEqual(["Reading", "Reading copy"]));
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Delete the table Reading copy" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Reading copy" })).toBeNull());
    const toast = state().toasts.at(-1)!;
    expect(toast.text).toContain("Deleted the table");
    await act(async () => toast.action!.run());
    await screen.findByRole("tab", { name: "Reading copy" });
    await waitFor(async () => expect(readOverview((await vault.read(PROJECT)).meta.props).tables.map((t) => t.name)).toEqual(["Reading", "Reading copy"]));
  });

  it("drop a table that was deleted when the last one goes, so the page keeps no setting it does not need", async () => {
    await open();
    await makeTable("Blank table");
    fireEvent.click(await within(screen.getByRole("tabpanel")).findByRole("button", { name: "Delete the table Table" }));
    await waitFor(async () => expect(await projectText()).not.toContain("overview"));
  });
});

describe("opening the overview", () => {
  it("is a place of its own for a project's page", () => {
    expect(overviewPlace(PROJECT)).toEqual({ view: "overview", path: PROJECT });
  });

  it("finds the project of where the person is: a page of it, its page or its overview", () => {
    const notes = state().notes;
    expect(currentProject({ view: "page", path: "projects/trip/pages/plan.md" }, notes)?.path).toBe(PROJECT);
    expect(currentProject({ view: "page", path: PROJECT }, notes)?.path).toBe(PROJECT);
    expect(currentProject(overviewPlace(PROJECT), notes)?.path).toBe(PROJECT);
    expect(currentProject({ view: "page", path: "inbox/loose.md" }, notes)).toBeUndefined();
    expect(currentProject({ view: "inbox" }, notes)).toBeUndefined();
  });

  it("is what the palette command opens from a page of a project, and a hint elsewhere", () => {
    state().go({ view: "page", path: "projects/trip/pages/plan.md" });
    openCurrentOverview();
    expect(state().place).toEqual({ view: "overview", path: PROJECT });
    state().go({ view: "page", path: "inbox/loose.md" });
    openCurrentOverview();
    expect(state().place.view).toBe("page");
    expect(state().toasts.at(-1)?.text).toContain("Open a page of a project first");
  });
});
