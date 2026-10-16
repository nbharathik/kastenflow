// Restoring a saved tab set: nothing open is closed, nothing is opened twice,
// a moved page is found by its id, a missing one is said so, and a layout
// puts the panes, the sidebar and the right panel back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";
import { usePanel } from "../panel/panel-store";
import { usePrefs } from "./prefs";
import { useWorkspace } from "./store";
import { derive } from "./store-layout";
import type { TabSet } from "./tab-sets";
import { focusedPane, initialLayout, type Place } from "./tabs";
import { currentArrangement, paneOrder, resolveTab, restoreSet, resumeSet, workspacesOf } from "./workspaces";

const page = (path: string): Place => ({ view: "page", path });
const web = (url: string): Place => ({ view: "web", url });
const note = (path: string, id: string | null): NoteMeta => ({ path, id, title: path, kind: "page", icon: null, cover: null, parent: null, project: null, tags: [], modified: 0, created: null, updated: null, excerpt: "", words: 0, props: {}, locked: false });
const toast = vi.fn();

const panes = () => useWorkspace.getState().layout.panes;
const labels = (index: number) => panes()[index]!.tabs.map((t) => t.place.path ?? t.place.url ?? t.place.view);

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ tabSets: [], sidebarWidth: 260 });
  useShell.setState({ sidebarOpen: true, panels: [] });
  useWorkspace.setState({ ...derive(initialLayout()), recent: [], notes: [note("a.md", "01A"), note("b.md", "01B"), note("moved/c.md", "01C")], toast });
  toast.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("finding a saved tab again", () => {
  const notes = [note("moved/c.md", "01C"), note("a.md", "01A")];

  it("follows a page by its id to where it is now", () => {
    expect(resolveTab({ place: page("old/c.md"), pinned: true, id: "01C" }, notes)).toEqual({ place: page("moved/c.md"), pinned: true, missing: false });
    expect(resolveTab({ place: page("a.md"), pinned: false, id: "01A" }, notes).place).toEqual(page("a.md"));
    expect(resolveTab({ place: page("a.md"), pinned: false }, notes).missing).toBe(false);
  });

  it("calls a page missing when neither its id nor its path is there, and anything but a page never", () => {
    expect(resolveTab({ place: page("gone.md"), pinned: false, id: "01X" }, notes)).toMatchObject({ place: page("gone.md"), missing: true });
    expect(resolveTab({ place: page("gone.md"), pinned: false }, notes).missing).toBe(true);
    for (const place of [{ view: "boards", path: "b.canvas" }, web("https://example.com"), { view: "library" }] as Place[]) {
      expect(resolveTab({ place, pinned: false }, notes).missing).toBe(false);
    }
  });

  it("puts a browser tab after the others, so what is shown first is a page", () => {
    expect(paneOrder([web("https://a.example"), page("a.md"), web("https://b.example"), page("b.md")])).toEqual([page("a.md"), page("b.md"), web("https://a.example"), web("https://b.example")]);
  });
});

describe("restoring a set of tabs", () => {
  const set: TabSet = { name: "Reading", tabs: [{ place: page("a.md"), pinned: true, id: "01A" }, { place: page("old/c.md"), pinned: false, id: "01C" }, { place: web("https://example.com/p"), pinned: false }] };

  it("opens the tabs after those open, pinned ones pinned, a page found by its id, and the page shown first", () => {
    const restored = restoreSet(set);
    expect(restored).toEqual({ tabs: 3, missing: [] });
    expect(labels(0)).toEqual(["a.md", "home", "moved/c.md", "https://example.com/p"]);
    expect(focusedPane(useWorkspace.getState().layout).tabs[0]!.pinned).toBe(true);
    expect(useWorkspace.getState().place).toEqual(page("a.md"));
  });

  it("closes nothing and opens nothing twice", () => {
    useWorkspace.getState().openTab(page("b.md"));
    restoreSet(set);
    restoreSet(set);
    expect(labels(0).filter((l) => l === "b.md")).toHaveLength(1);
    expect(labels(0).filter((l) => l === "a.md")).toHaveLength(1);
    expect(panes()).toHaveLength(1);
    expect(labels(0)).toContain("home");
  });

  it("opens a missing page anyway, and says which were not found", () => {
    const gone: TabSet = { name: "Trip", tabs: [{ place: page("gone.md"), pinned: false, id: "01Z" }, { place: page("a.md"), pinned: false }] };
    const restored = resumeSet(gone);
    expect(restored.missing).toEqual(["gone"]);
    expect(labels(0)).toContain("gone.md");
    expect(labels(0)).toContain("a.md");
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Opened “Trip”.*gone.*trash/));
    toast.mockClear();
    resumeSet({ name: "Fine", tabs: [{ place: page("b.md"), pinned: false }] });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("restoring a set with its layout", () => {
  const set: TabSet = {
    name: "Writing",
    project: "trip",
    tabs: [{ place: page("a.md"), pinned: true, id: "01A" }, { place: page("b.md"), pinned: false }, { place: { view: "boards", path: "m.canvas" }, pinned: false }, { place: web("https://example.com/x"), pinned: false }],
    layout: { panes: [{ tabs: [0, 1], size: 2 }, { tabs: [3, 2], size: 1 }], sidebarOpen: false, sidebarWidth: 300, right: { open: true, width: 380, tab: "history" } },
  };

  it("puts the panes, their widths, the sidebar and the right panel back", () => {
    restoreSet(set);
    expect(panes()).toHaveLength(2);
    expect(labels(0)).toEqual(["a.md", "home", "b.md"]);
    // The browser tab goes after the board, so the pane shows the board.
    expect(labels(1)).toEqual(["m.canvas", "https://example.com/x"]);
    expect(panes().map((p) => p.size)).toEqual([2, 1]);
    expect(useShell.getState().sidebarOpen).toBe(false);
    expect(usePrefs.getState().sidebarWidth).toBe(300);
    const second = panes()[1]!.id;
    expect(useShell.getState().panels).toContain(second);
    expect(usePanel.getState().tabs[second]).toBe("history");
    expect(usePanel.getState().widths[second]).toBe(380);
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: "m.canvas" });
  });

  it("is the same window when restored again", () => {
    restoreSet(set);
    const once = JSON.stringify(panes().map((p) => p.tabs.map((t) => t.place)));
    restoreSet(set);
    expect(JSON.stringify(panes().map((p) => p.tabs.map((t) => t.place)))).toBe(once);
    expect(panes()).toHaveLength(2);
  });

  it("leaves the sidebar and the panel alone when the set says nothing of them", () => {
    restoreSet({ name: "Bare", tabs: set.tabs.slice(0, 2), layout: { panes: [{ tabs: [0, 1] }] } });
    expect(useShell.getState().sidebarOpen).toBe(true);
    expect(usePrefs.getState().sidebarWidth).toBe(260);
    expect(useShell.getState().panels).toEqual([]);
    expect(panes()).toHaveLength(1);
  });

  it("does not take the widths when the window holds panes the set does not", () => {
    useWorkspace.getState().splitRight(page("b.md"));
    useWorkspace.getState().splitRight(page("a.md"));
    expect(panes()).toHaveLength(3);
    restoreSet(set);
    expect(panes()).toHaveLength(3);
    expect(panes().some((p) => p.size === 2)).toBe(false);
  });
});

describe("saving what the window looks like now, and the sets of a project", () => {
  it("reads the sidebar, its width and the focused pane's panel", () => {
    useShell.setState({ sidebarOpen: false, panels: [] });
    usePrefs.setState({ sidebarWidth: 280 });
    expect(currentArrangement()).toMatchObject({ sidebarOpen: false, sidebarWidth: 280, right: { open: false } });
    useShell.getState().openPanel(useWorkspace.getState().layout.focus);
    expect(currentArrangement().right?.open).toBe(true);
  });

  it("finds the sets linked to a project among the saved ones", () => {
    usePrefs.setState({ tabSets: [{ name: "Writing", tabs: [{ place: page("a.md"), pinned: false }], project: "trip" }, { name: "Other", tabs: [{ place: page("a.md"), pinned: false }] }] });
    expect(workspacesOf("trip").map((s) => s.name)).toEqual(["Writing"]);
    expect(workspacesOf("essay")).toEqual([]);
  });
});
