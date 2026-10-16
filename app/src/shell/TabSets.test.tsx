import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { focusedPane, initialLayout } from "../features/workspace/tabs";
import { TabSets } from "./TabSets";

const page = (path: string) => ({ view: "page" as const, path });
const pane = () => focusedPane(useWorkspace.getState().layout);
const openPaths = () => pane().tabs.map((t) => t.place.path ?? t.place.view);

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ tabSets: [] });
  useWorkspace.setState({ ...derive(initialLayout()), recent: [] });
});
afterEach(cleanup);

describe("tab sets", () => {
  it("saves the tabs open here and opens them all again, pinned ones pinned", async () => {
    act(() => useWorkspace.getState().openTabs([page("library/a.md"), page("library/b.md")], [page("library/b.md")]));
    const { rerender } = render(<TabSets pane={pane()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tab sets" }));
    const menu = screen.getByRole("dialog", { name: "Tab sets" });
    const name = within(menu).getByRole("textbox", { name: "Name for the tabs open here" });
    expect(name.getAttribute("placeholder")).toBe("Name these 2 tabs…");
    fireEvent.change(name, { target: { value: "Reading" } });
    fireEvent.submit(name.closest("form")!);
    expect(usePrefs.getState().tabSets).toEqual([
      {
        name: "Reading",
        tabs: [
          { place: page("library/b.md"), pinned: true },
          { place: page("library/a.md"), pinned: false },
        ],
      },
    ]);
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).tabSets[0].name).toBe("Reading");

    // Close them all, then bring the set back.
    act(() => useWorkspace.setState({ ...derive(initialLayout()) }));
    rerender(<TabSets pane={pane()} />);
    await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: "Tab sets" })).getByRole("button", { name: /^Reading/ })));
    expect(openPaths()).toEqual(["library/b.md", "home", "library/a.md"]);
    expect(pane().tabs[0]!.pinned).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Tab sets" })).toBeNull();
  });

  it("saves every pane and the panels when asked, and brings the window back as it was", async () => {
    act(() => {
      useWorkspace.getState().openTabs([page("library/a.md")], []);
      useWorkspace.getState().splitRight(page("library/b.md"));
    });
    expect(useWorkspace.getState().layout.panes).toHaveLength(2);
    render(<TabSets pane={pane()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tab sets" }));
    const menu = within(screen.getByRole("dialog", { name: "Tab sets" }));
    // Without the layout only the tabs of this pane are kept.
    expect(menu.getByRole("textbox", { name: "Name for the tabs open here" }).getAttribute("placeholder")).toBe("Name these 1 tabs…");
    fireEvent.click(menu.getByRole("checkbox", { name: /Save layout too/ }));
    const name = menu.getByRole("textbox", { name: "Name for the tabs open here" });
    expect(name.getAttribute("placeholder")).toBe("Name these 2 tabs…");
    fireEvent.change(name, { target: { value: "Side by side" } });
    fireEvent.submit(name.closest("form")!);
    const [saved] = usePrefs.getState().tabSets;
    expect(saved!.tabs.map((t) => t.place.path)).toEqual(["library/a.md", "library/b.md"]);
    expect(saved!.layout?.panes.map((p) => p.tabs)).toEqual([[0], [1]]);
    expect(saved!.layout?.sidebarOpen).toBe(true);
    expect(menu.getByRole("button", { name: /^Side by side/ }).textContent).toContain("2 tabs · layout");

    // Close it all, then bring it back: two panes again, one tab each.
    act(() => useWorkspace.setState({ ...derive(initialLayout()) }));
    expect(useWorkspace.getState().layout.panes).toHaveLength(1);
    await act(async () => fireEvent.click(menu.getByRole("button", { name: /^Side by side/ })));
    const panes = useWorkspace.getState().layout.panes;
    expect(panes.map((p) => p.tabs.map((t) => t.place.path ?? t.place.view))).toEqual([["home", "library/a.md"], ["library/b.md"]]);
  });

  it("starts a name from Reading, Writing or Presentation prep, which keeps the layout", () => {
    act(() => useWorkspace.getState().openTabs([page("library/a.md")], []));
    render(<TabSets pane={pane()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tab sets" }));
    const menu = within(screen.getByRole("dialog", { name: "Tab sets" }));
    expect((menu.getByRole("checkbox", { name: /Save layout too/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(menu.getByRole("button", { name: "Start a set called Presentation prep" }));
    expect((menu.getByRole("textbox", { name: "Name for the tabs open here" }) as HTMLInputElement).value).toBe("Presentation prep");
    expect((menu.getByRole("checkbox", { name: /Save layout too/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(menu.getByRole("button", { name: "Save" }));
    expect(usePrefs.getState().tabSets[0]).toMatchObject({ name: "Presentation prep", layout: { panes: [{ tabs: [0] }] } });
  });

  it("links a set to a project, and says so in the list", async () => {
    const vault = new MemoryVault({ "projects/trip/_project.md": "---\nid: 01P\ntitle: Trip plan\ntype: project\n---\n", "library/a.md": "---\nid: 01A\ntitle: A\n---\nA\n" });
    act(() => useWorkspace.setState({ notes: [] }));
    useWorkspace.setState({ notes: await vault.list() });
    act(() => useWorkspace.getState().openTabs([page("library/a.md")], []));
    render(<TabSets pane={pane()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tab sets" }));
    const menu = within(screen.getByRole("dialog", { name: "Tab sets" }));
    expect(menu.getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "Trip plan"]);
    fireEvent.change(menu.getByRole("combobox", { name: "Link to project" }), { target: { value: "trip" } });
    const name = menu.getByRole("textbox", { name: "Name for the tabs open here" });
    fireEvent.change(name, { target: { value: "Trip reading" } });
    fireEvent.submit(name.closest("form")!);
    expect(usePrefs.getState().tabSets).toEqual([{ name: "Trip reading", tabs: [{ place: page("library/a.md"), pinned: false, id: "01A" }], project: "trip" }]);
    expect(menu.getByRole("button", { name: /^Trip reading/ }).textContent).toContain("Trip plan");
    // Forgetting it leaves the pages alone.
    fireEvent.click(menu.getByRole("button", { name: "Forget the set Trip reading" }));
    expect(usePrefs.getState().tabSets).toEqual([]);
  });
});
