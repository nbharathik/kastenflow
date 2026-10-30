import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useBoards } from "../features/boards/store";
import { NOTE_DRAG } from "../features/workspace/drag";
import { usePrefs } from "../features/workspace/prefs";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { derive } from "../features/workspace/store-layout";
import { useWorkspace } from "../features/workspace/store";
import { initialLayout } from "../features/workspace/tabs";
import { useShell } from "../lib/store";
import { AppShell } from "./AppShell";

const BOARD = "projects/demo/boards/plan.canvas";
const SEED = {
  "projects/demo/_project.md": "---\ntitle: Demo project\ntype: project\n---\nThe project.\n",
  "projects/demo/pages/roadmap.md": "---\ntitle: Roadmap\n---\nSoon.\n",
  [BOARD]: JSON.stringify({ nodes: [], edges: [], "x-kasten": { title: "Launch plan" } }),
};

let vault: MemoryVault;

// The palette and the boards view load when first shown; their module-load latency is separate from what is asserted below.
beforeAll(async () => {
  await import("../features/workspace/overlays/Palette");
  await import("../features/boards/BoardsHome");
}, 60_000);

/** A DataTransfer good enough for dragstart in jsdom. */
function transfer() {
  const data = new Map<string, string>();
  return { data, types: [] as string[], effectAllowed: "", setData: (type: string, value: string) => void data.set(type, value), getData: (type: string) => data.get(type) ?? "" };
}

/** Opens the Demo project in the sidebar; rows stay open across tests. */
async function expandDemo(projects: HTMLElement) {
  await within(projects).findByText("Demo project");
  const expand = within(projects).queryByRole("button", { name: "Expand Demo project" });
  if (expand) await act(async () => fireEvent.click(expand));
}

async function renderShell() {
  render(<AppShell connect={async () => ({ client: vault })} />);
  return screen.findByRole("navigation", { name: "Sidebar" });
}

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  usePrefs.setState({ favourites: [] });
  useBoards.setState({ list: [], loaded: false });
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, panels: [] });
});
afterEach(cleanup);

describe("boards in the sidebar", () => {
  it("lists a project's boards under it and opens one in a tab named after it", async () => {
    const sidebar = await renderShell();
    const projects = await within(sidebar).findByRole("region", { name: "Projects" });
    await expandDemo(projects);
    const row = await within(projects).findByRole("button", { name: "Launch plan" });
    await act(async () => fireEvent.click(row));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: BOARD });
    expect(await screen.findByRole("tab", { name: "Launch plan" })).toBeTruthy();
    // The top bar says where the board lives, and stars it.
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toMatch(/Whiteboards\/.*Demo project\/Launch plan$/);
    fireEvent.click(screen.getByRole("button", { name: "Add to Favourites" }));
    expect(usePrefs.getState().favourites).toEqual([BOARD]);
    fireEvent.click(within(crumbs).getByRole("button", { name: /Whiteboards/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards" });
  });

  it("shows favourite boards under Favourites", async () => {
    usePrefs.setState({ favourites: [BOARD] });
    const sidebar = await renderShell();
    const favourites = await within(sidebar).findByRole("region", { name: "Favourites" });
    expect(await within(favourites).findByRole("button", { name: "Launch plan" })).toBeTruthy();
  });

  it("drags pages and boards as notes, for dropping on a board", async () => {
    const sidebar = await renderShell();
    const projects = await within(sidebar).findByRole("region", { name: "Projects" });
    await expandDemo(projects);
    const page = (await within(projects).findByRole("button", { name: "Roadmap" })).closest("[draggable]")!;
    const pageDrag = transfer();
    fireEvent.dragStart(page, { dataTransfer: pageDrag });
    expect(pageDrag.data.get(NOTE_DRAG)).toBe("projects/demo/pages/roadmap.md");
    const board = (await within(projects).findByRole("button", { name: "Launch plan" })).closest("[draggable]")!;
    const boardDrag = transfer();
    fireEvent.dragStart(board, { dataTransfer: boardDrag });
    expect(boardDrag.data.get(NOTE_DRAG)).toBe(BOARD);
  });

  it("finds boards in the palette, recent ones first, and starts new ones", async () => {
    const sidebar = await renderShell();
    await within(sidebar).findByText("Demo project");
    await act(async () => useBoards.getState().load());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    // The palette's code loads when it is first opened.
    const search = await screen.findByRole("textbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "launch" } });
    const results = screen.getByRole("listbox", { name: "Results" });
    const row = results.querySelector('[aria-selected="true"]');
    expect(row?.textContent).toContain("Launch plan");
    expect(row?.textContent).toContain("Whiteboard · Demo project");
    await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: BOARD });

    // Opened once, it is among the recent places.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect((await screen.findByRole("listbox", { name: "Results" })).textContent).toContain("Launch plan");
    const again = screen.getByRole("textbox", { name: "Search" });
    fireEvent.change(again, { target: { value: "new whiteboard" } });
    await act(async () => fireEvent.keyDown(again, { key: "Enter" }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards" });
    expect(await screen.findByRole("form", { name: "New whiteboard" })).toBeTruthy();
  });

  it("shows a board opened lately on Home, with the pages to jump back to", async () => {
    const sidebar = await renderShell();
    await within(sidebar).findByText("Demo project");
    await act(async () => useBoards.getState().load());
    await act(async () => useWorkspace.getState().openPath(BOARD));
    await act(async () => useWorkspace.getState().go({ view: "home" }));
    const jump = await screen.findByRole("region", { name: "Recent" });
    const tile = within(jump).getByRole("button", { name: /Launch plan/ });
    expect(tile.textContent).toContain("Whiteboard");
    await act(async () => fireEvent.click(tile));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: BOARD });
  });

  it("starts a whiteboard in a project from its menu", async () => {
    const sidebar = await renderShell();
    const projects = await within(sidebar).findByRole("region", { name: "Projects" });
    await within(projects).findByText("Demo project");
    fireEvent.click(within(projects).getByRole("button", { name: "More for Demo project" }));
    await act(async () => fireEvent.click(screen.getByText("New whiteboard here")));
    expect(useWorkspace.getState().place).toEqual({ view: "boards" });
    const form = await screen.findByRole("form", { name: "New whiteboard" });
    expect((within(form).getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("demo");
  });

  it("opens a board beside the page when asked for the side stack", async () => {
    const sidebar = await renderShell();
    await within(sidebar).findByText("Demo project");
    await act(async () => useWorkspace.getState().openPath(BOARD, "stack"));
    const state = useWorkspace.getState();
    expect(state.stack).toEqual([]);
    expect(state.layout.panes).toHaveLength(2);
    expect(state.place).toEqual({ view: "boards", path: BOARD });
  });
});
