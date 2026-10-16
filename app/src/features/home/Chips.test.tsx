// Home's thin rows: favourites and projects, with a few chips and a "+N" for the rest.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import type { ProjectSummary } from "../../lib/vault/project-types";
import type { NoteMeta, VaultClient } from "../../lib/vault/types";
import { OpenMenuHost } from "../../shell/open-menu";
import { summary } from "../projects/hub/test-support";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { Favourites } from "./Favourites";
import { ProjectTiles } from "./ProjectTiles";

const note = (path: string, title: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title,
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});
const project = (folder: string, title: string, over: Partial<NoteMeta> = {}): NoteMeta => note(`projects/${folder}/_project.md`, title, { kind: "project", project: folder, id: folder, ...over });

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ favourites: [], projectOrder: [], pinnedProjects: [], newTabs: false });
  useShell.setState({ namingProject: false });
  useWorkspace.setState({ client: null, notes: [], ready: true, ...derive(initialLayout()), stack: [], stackOpen: false });
});
afterEach(cleanup);

describe("Home's favourites", () => {
  it("draw nothing until there is one, and skip a favourite that is gone", () => {
    useWorkspace.setState({ notes: [note("library/a.md", "Alpha")] });
    usePrefs.setState({ favourites: ["library/missing.md"] });
    const view = render(<Favourites />);
    expect(view.container.textContent).toBe("");
    act(() => usePrefs.setState({ favourites: ["library/missing.md", "library/a.md"] }));
    expect(within(screen.getByRole("group", { name: "Favourites" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Alpha"]);
  });

  it("keep their place while the vault is read, when there are starred notes to come", () => {
    useWorkspace.setState({ notes: [], ready: false });
    usePrefs.setState({ favourites: ["library/a.md"] });
    const view = render(<Favourites />);
    expect(view.container.querySelectorAll(".kasten-home-bone")).toHaveLength(2);
    act(() => usePrefs.setState({ favourites: [] }));
    expect(view.container.textContent).toBe("");
    expect(view.container.querySelectorAll(".kasten-home-bone")).toHaveLength(0);
  });

  it("show seven and put the rest behind +N, which opens them", () => {
    const notes = Array.from({ length: 10 }, (_, i) => note(`library/n${i}.md`, `Note ${i}`));
    useWorkspace.setState({ notes });
    usePrefs.setState({ favourites: notes.map((n) => n.path) });
    render(<Favourites />);
    const row = screen.getByRole("group", { name: "Favourites" });
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Note 0", "Note 1", "Note 2", "Note 3", "Note 4", "Note 5", "Note 6", "+3"]);
    fireEvent.click(within(row).getByRole("button", { name: "More favourites" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Note 8/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "library/n8.md" });
  });

  it("open a note on a click, in a tab with Ctrl, and give it the Open menu", () => {
    useWorkspace.setState({ notes: [note("library/a.md", "Alpha")] });
    usePrefs.setState({ favourites: ["library/a.md"] });
    render(
      <>
        <Favourites />
        <OpenMenuHost />
      </>,
    );
    const chip = screen.getByRole("button", { name: /Alpha/ });
    fireEvent.click(chip, { ctrlKey: true });
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["home", "page"]);
    fireEvent.contextMenu(chip);
    expect(screen.getByRole("menu", { name: "Open" })).toBeTruthy();
  });
});

describe("Home's projects row", () => {
  it("is one thin row of the projects in use, a link to all of them, and a button for a new one", () => {
    useWorkspace.setState({ notes: [project("trip", "Trip"), project("garden", "Garden")] });
    render(<ProjectTiles />);
    const row = screen.getByRole("group", { name: "Projects" });
    expect(within(row).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Garden", "Trip", "All projects", "New project"]);
    fireEvent.click(within(row).getByRole("button", { name: /Trip/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "projects/trip/_project.md" });
    fireEvent.click(within(row).getByRole("button", { name: "New project" }));
    expect(useShell.getState().namingProject).toBe(true);
  });

  it("opens the Projects hub from All projects, in a tab with Ctrl", () => {
    useWorkspace.setState({ notes: [project("trip", "Trip")] });
    render(<ProjectTiles />);
    fireEvent.click(screen.getByRole("button", { name: "All projects" }), { ctrlKey: true });
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["home", "projects"]);
    fireEvent.click(screen.getByRole("button", { name: "All projects" }));
    expect(useWorkspace.getState().place).toEqual({ view: "projects" });
  });

  it("draws nothing while there is no project", () => {
    const view = render(<ProjectTiles />);
    expect(view.container.textContent).toBe("");
  });

  it("puts the pinned projects first and then the one changed most recently, and says which are paused or done", async () => {
    const stamp = (folder: string, modified: number, extra: Partial<ProjectSummary> = {}) => summary(folder, { latest: { modified, path: "p", title: "t", kind: "page" }, ...extra });
    useWorkspace.setState({
      notes: [project("trip", "Trip"), project("garden", "Garden"), project("taxes", "Taxes", { props: { status: "Done" } }), project("novel", "Novel", { props: { status: "paused" } })],
      client: { projectSummaries: async () => [stamp("trip", 1000), stamp("garden", 5000), stamp("taxes", 9000), stamp("novel", 3000)] } as unknown as VaultClient,
    });
    usePrefs.setState({ pinnedProjects: ["trip"] });
    render(<ProjectTiles />);
    const names = () => within(screen.getByRole("group", { name: "Projects" })).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    // Until the summaries arrive: the sidebar's order, pinned first, then by title.
    expect(names()).toEqual(["Trip", "Garden", "NovelPaused", "TaxesDone", "All projects", "New project"]);
    await waitFor(() => expect(names()).toEqual(["Trip", "TaxesDone", "Garden", "NovelPaused", "All projects", "New project"]));
  });
});
