import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../lib/dates";
import { useShell } from "../../lib/store";
import { AppShell } from "../../shell/AppShell";
import { journalPath } from "../journal/feed";
import { usePrefs } from "../workspace/prefs";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { derive } from "../workspace/store-layout";
import { useWorkspace } from "../workspace/store";
import { initialLayout } from "../workspace/tabs";

const TEMPLATES = {
  "templates/page.md": '---\ntitle: "{{title}}"\ntype: page\n---\n',
  "templates/travel.md": '---\ntitle: "{{title}}"\ntype: page\n---\n## Itinerary\n',
};

async function home(files: Record<string, string>) {
  const vault = new MemoryVault(files);
  render(<AppShell connect={async () => ({ client: vault })} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
  await act(async () => useWorkspace.getState().go({ view: "home" }));
  return vault;
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ homeSections: null, homeFilter: "all", homeProject: null, homeLayout: "list" });
  useShell.setState({ namingProject: false });
  useWorkspace.setState({ ...derive(initialLayout()), notes: [], recent: [], navigated: false });
});
afterEach(cleanup);

describe("Home", () => {
  it("greets a blank vault with a first page and the tour, and no sample content", async () => {
    const vault = await home(TEMPLATES);
    const start = await screen.findByRole("region", { name: "Getting started" });
    expect(screen.queryByRole("region", { name: "Start from a template" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Projects" })?.closest("main")).toBeFalsy();
    await act(async () => fireEvent.click(within(start).getByRole("button", { name: "Take the tour" })));
    await expect.poll(() => useWorkspace.getState().place.path, { timeout: 15_000 }).toBe("library/welcome-to-kasten.md");
    expect((await vault.read("library/welcome-to-kasten.md")).text).toContain("title: Welcome to KastenFlow");
  });

  it("leaves the blank-vault welcome out once there is writing", async () => {
    await home({ ...TEMPLATES, "library/idea.md": "---\ntitle: An idea\n---\nText.\n" });
    await screen.findByRole("region", { name: "Recent" });
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });

  it("is short by default: the list, today, the to-dos and the Inbox, and nothing else", async () => {
    await home({ ...TEMPLATES, "library/idea.md": "---\ntitle: An idea\n---\nText.\n", "inbox/note.md": "---\ntitle: A note\ntype: card\n---\nText.\n" });
    const pane = screen.getByRole("region", { name: "Pane" });
    for (const name of ["Recent", "Today", "To-dos", "Inbox"]) expect(await within(pane).findByRole("region", { name })).toBeTruthy();
    for (const name of ["Projects", "Pages", "Whiteboards", "Decks", "Journal", "This week"]) expect(within(pane).queryByRole("region", { name })).toBeNull();
    // One line at the top: the greeting, the capture field, one New button. No row of buttons.
    expect(within(pane).getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(within(pane).getByRole("textbox", { name: "Quick note" })).toBeTruthy();
    expect(within(pane).getByRole("button", { name: "New" })).toBeTruthy();
    for (const old of ["Quick note", "Today's journal", "From a template", "New deck", "Search"]) expect(within(pane).queryByRole("button", { name: old })).toBeNull();
  });

  it("keeps the sections chosen with Customize, in their order, and puts the simple layout back", async () => {
    await home({ ...TEMPLATES, "library/idea.md": "---\ntitle: An idea\n---\nText.\n" });
    expect(screen.queryByRole("region", { name: "Journal" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customize home" }));
    const menu = screen.getByRole("dialog", { name: "Customize home" });
    const reset = within(menu).getByRole("button", { name: "Reset to the simple layout" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.click(within(menu).getByRole("checkbox", { name: /Journal/ }));
    // The card's code loads when it is first asked for (the whiteboard and deck thumbnails come with it).
    expect(await screen.findByRole("region", { name: "Journal" }, { timeout: 20_000 })).toBeTruthy();
    expect(usePrefs.getState().homeSections).toEqual(["favourites", "recent", "schedule", "todo", "inbox", "journal"]);
    fireEvent.click(within(menu).getByRole("checkbox", { name: /Favourites/ }));
    expect(usePrefs.getState().homeSections).toEqual(["recent", "schedule", "todo", "inbox", "journal"]);
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).homeSections).toContain("journal");
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(usePrefs.getState().homeSections).toBeNull();
    await expect.poll(() => screen.queryByRole("region", { name: "Journal" })).toBeNull();
  });

  it("lists every project's pages, and the rest, each a click away, when Pages is turned on", async () => {
    usePrefs.setState({ homeSections: ["recent", "pages"] });
    const vault = await home({
      ...TEMPLATES,
      "projects/trip/_project.md": "---\nid: T\ntitle: Trip\ntype: project\n---\n",
      "projects/trip/pages/packing.md": "---\nid: P\ntitle: Packing\n---\n",
      "projects/trip/pages/snacks.md": "---\ntitle: Snacks\nparent: P\n---\n",
      "projects/trip/pages/budget.md": "---\ntitle: Budget\n---\n",
      "projects/trip/cards/idea.md": "---\ntitle: A card\ntype: card\n---\n",
      "projects/garden/_project.md": "---\ntitle: Garden\ntype: project\n---\n",
      "library/idea.md": "---\ntitle: An idea\n---\nText.\n",
    });
    const pane = screen.getByRole("region", { name: "Pane" });
    const pages = await within(pane).findByRole("region", { name: "Pages" });
    const trip = within(pages).getByRole("group", { name: "Trip" });
    // The project's pages, sub-pages under their page; cards stay in the library.
    const names = within(trip)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.querySelector(".kasten-dash-row-title")?.textContent ?? b.textContent);
    expect(names).toEqual(["Trip", "New page in Trip", "Budget", "Packing", "Snacks"]);
    expect(within(trip).queryByText("A card")).toBeNull();
    expect(within(pages).getByRole("group", { name: "Other pages" }).textContent).toContain("An idea");
    await act(async () => fireEvent.click(within(trip).getByRole("button", { name: /^Snacks/ })));
    await expect.poll(() => useWorkspace.getState().place.path).toBe("projects/trip/pages/snacks.md");
    // A project with no pages yet offers its first.
    await act(async () => useWorkspace.getState().go({ view: "home" }));
    const garden = within(await within(screen.getByRole("region", { name: "Pane" })).findByRole("region", { name: "Pages" })).getByRole("group", { name: "Garden" });
    await act(async () => fireEvent.click(within(garden).getByRole("button", { name: "New page in Garden" })));
    // It opens as a draft, and its first input makes it in the project.
    const draft = useWorkspace.getState().place.path!;
    expect((await vault.list()).some((n) => n.path.startsWith("projects/garden/"))).toBe(true);
    expect((await vault.list()).some((n) => n.path.startsWith("projects/garden/pages/"))).toBe(false);
    await act(async () => void (await useWorkspace.getState().client!.rename(draft, "Beds")));
    await expect.poll(async () => (await vault.list()).some((n) => n.path.startsWith("projects/garden/pages/"))).toBe(true);
  });

  it("adds a to-do from Home to today's journal and lists it as written", async () => {
    const vault = await home({ ...TEMPLATES, "templates/journal.md": '---\ntitle: "{{date}}"\ntype: journal\n---\n' });
    const todos = await screen.findByRole("region", { name: "To-dos" });
    const field = within(todos).getByRole("textbox", { name: "Add a to-do" });
    fireEvent.change(field, { target: { value: "Pack snacks - fruit + nuts" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(async () => (await vault.read(journalPath(dayFrom(0))).catch(() => null))?.text ?? "").toContain("## To-dos\n\n- [ ] Pack snacks - fruit + nuts\n");
    expect(await within(todos).findByRole("checkbox", { name: "Pack snacks - fruit + nuts" })).toBeTruthy();
  });

  it("starts a new project in the sidebar's name field from the projects row", async () => {
    usePrefs.setState({ homeSections: ["projects", "recent"] });
    await home({ ...TEMPLATES, "projects/p/_project.md": "---\ntitle: Existing\ntype: project\n---\n" });
    const pane = screen.getByRole("region", { name: "Pane" });
    const projects = await within(pane).findByRole("group", { name: "Projects" });
    expect(within(projects).getByRole("button", { name: /Existing/ })).toBeTruthy();
    await act(async () => fireEvent.click(within(projects).getByRole("button", { name: "New project" })));
    expect(await screen.findByRole("textbox", { name: "Project name" })).toBeTruthy();
  });

  it("shows the favourites as a thin row, and nothing while there are none", async () => {
    usePrefs.setState({ favourites: [] });
    await home({ ...TEMPLATES, "library/idea.md": "---\ntitle: An idea\n---\nText.\n" });
    const pane = screen.getByRole("region", { name: "Pane" });
    await within(pane).findByRole("region", { name: "Recent" });
    expect(within(pane).queryByRole("group", { name: "Favourites" })).toBeNull();
    act(() => usePrefs.setState({ favourites: ["library/idea.md"] }));
    const row = await within(pane).findByRole("group", { name: "Favourites" });
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: /An idea/ })));
    expect(useWorkspace.getState().place.path).toBe("library/idea.md");
    act(() => usePrefs.setState({ favourites: [] }));
  });
});
