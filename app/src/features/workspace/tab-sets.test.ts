import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { readSets, setOf, setOfWindow, setsOfProject, withSet, withoutSet, type TabSet } from "./tab-sets";
import { focusedPane, initialLayout, openTabs, resizePanes, split, type Place } from "./tabs";

const page = (path: string): Place => ({ view: "page", path });
const note = (path: string, id: string | null): NoteMeta => ({ path, id, title: path, kind: "page", icon: null, cover: null, parent: null, project: null, tags: [], modified: 0, created: null, updated: null, excerpt: "", words: 0, props: {}, locked: false });

describe("tab sets", () => {
  it("saves a pane's tabs, pinned ones pinned, without Home", () => {
    const layout = openTabs(initialLayout(), [page("a.md"), { view: "boards", path: "b.canvas" }], [page("a.md")]);
    const set = setOf(focusedPane(layout), "  Writing   week ")!;
    expect(set.name).toBe("Writing week");
    expect(set.tabs).toEqual([
      { place: page("a.md"), pinned: true },
      { place: { view: "boards", path: "b.canvas" }, pinned: false },
    ]);
    expect(setOf(focusedPane(initialLayout()), "Empty")).toBeNull();
    expect(setOf(focusedPane(layout), " ")).toBeNull();
  });

  it("keeps a page's id, and the project a set belongs to", () => {
    const layout = openTabs(initialLayout(), [page("a.md"), page("b.md")]);
    const set = setOf(focusedPane(layout), "Trip", [note("a.md", "01A"), note("b.md", null)], "trip")!;
    expect(set.tabs).toEqual([{ place: page("a.md"), pinned: false, id: "01A" }, { place: page("b.md"), pinned: false }]);
    expect(set.project).toBe("trip");
  });

  it("replaces a set of the same name, removes one, and reads stored ones leniently", () => {
    const one = { name: "Trip", tabs: [{ place: page("a.md"), pinned: false }] };
    const two = { name: "trip", tabs: [{ place: page("b.md"), pinned: true }] };
    expect(withSet([one], two)).toEqual([two]);
    expect(withoutSet([one], "Trip")).toEqual([]);
    expect(readSets([one, { name: 3 }, { name: "Bad", tabs: [{ place: { view: "nope" } }] }, null])).toEqual([one]);
    expect(readSets("x")).toEqual([]);
  });
});

describe("a set saved with the window's layout", () => {
  const two = () => {
    let layout = openTabs(initialLayout(), [page("a.md"), page("b.md")], [page("a.md")]);
    layout = split(layout, { view: "boards", path: "m.canvas" });
    layout = openTabs(layout, [page("a.md"), { view: "web", url: "https://example.com/x" }]);
    const [left, right] = layout.panes;
    return resizePanes(layout, { [left!.id]: 2, [right!.id]: 1 });
  };
  const arrangement = { sidebarOpen: false, sidebarWidth: 300.4, right: { open: true, width: 360, tab: "history" } };

  it("keeps each pane's tabs, their widths, the sidebar and the right panel", () => {
    const set = setOfWindow(two(), "Reading", [note("a.md", "01A")], arrangement, "trip")!;
    expect(set.tabs.map((t) => t.place)).toEqual([page("a.md"), page("b.md"), { view: "boards", path: "m.canvas" }, { view: "web", url: "https://example.com/x" }]);
    // The page both panes hold is one tab; the left pane keeps its pinned tab first.
    expect(set.layout).toEqual({
      panes: [{ tabs: [0, 1], size: 2 }, { tabs: [2, 0, 3], size: 1 }],
      sidebarOpen: false,
      sidebarWidth: 300,
      right: { open: true, width: 360, tab: "history" },
    });
    expect(set.tabs[0]).toEqual({ place: page("a.md"), pinned: true, id: "01A" });
    expect(set.project).toBe("trip");
  });

  it("leaves Home out, and a window with nothing else saves nothing", () => {
    expect(setOfWindow(initialLayout(), "Empty", [], arrangement)).toBeNull();
    expect(setOfWindow(two(), "  ", [], arrangement)).toBeNull();
    const homeAndPage = split(openTabs(initialLayout(), [page("a.md")]), { view: "home" });
    const set = setOfWindow(homeAndPage, "One", [], arrangement)!;
    expect(set.layout!.panes).toHaveLength(1);
  });

  it("is read back from storage as it was saved", () => {
    const set = setOfWindow(two(), "Reading", [note("a.md", "01A")], arrangement, "trip")!;
    const stored = JSON.parse(JSON.stringify([set]));
    expect(readSets(stored)).toEqual([set]);
  });

  it("leaves out a layout that does not hold together, and keeps the tabs", () => {
    const base = { name: "S", tabs: [{ place: page("a.md"), pinned: false }, { place: page("b.md"), pinned: false }] };
    const read = (layout: unknown) => readSets([{ ...base, layout }])[0]!;
    expect(read({ panes: [{ tabs: [0, 5] }], sidebarWidth: 1000 }).layout).toEqual({ panes: [{ tabs: [0] }], sidebarWidth: 640 });
    for (const bad of [null, "x", { panes: "x" }, { panes: [] }, { panes: [{ tabs: [] }] }, { panes: [{ tabs: [9] }] }, { panes: Array.from({ length: 4 }, () => ({ tabs: [0] })) }]) {
      const set = read(bad);
      expect(set.layout, JSON.stringify(bad)).toBeUndefined();
      expect(set.tabs).toHaveLength(2);
    }
    // A tab that could not be read shifts the numbers: the layout goes, the tabs stay.
    const shifted = readSets([{ name: "S", tabs: [{ place: { view: "nope" } }, ...base.tabs], layout: { panes: [{ tabs: [0, 1] }] } }])[0]!;
    expect(shifted.layout).toBeUndefined();
    expect(shifted.tabs).toHaveLength(2);
  });

  it("reads sets saved before layouts, ids and projects existed, and checks what is new", () => {
    const old: TabSet = { name: "Old", tabs: [{ place: page("a.md"), pinned: true }] };
    expect(readSets([old])).toEqual([old]);
    const odd = readSets([
      { name: "A", tabs: [{ place: { view: "web", url: "https://example.com" }, pinned: false }], project: "trip" },
      { name: "B", tabs: [{ place: { view: "web", url: "javascript:alert(1)" }, pinned: false }] },
      { name: "C", tabs: [{ place: { view: "web", url: `https://example.com/${"x".repeat(3000)}` }, pinned: false }] },
      { name: "D", tabs: [{ place: page("a.md"), pinned: false }], project: "../outside" },
      { name: "E", tabs: [{ place: page("a.md"), pinned: false, id: 5 }] },
    ]);
    expect(odd.map((s) => s.name)).toEqual(["A", "D", "E"]);
    expect(odd[0]!.tabs[0]!.place).toEqual({ view: "web", url: "https://example.com" });
    expect(odd[0]!.project).toBe("trip");
    expect(odd[1]!.project).toBeUndefined();
    expect(odd[2]!.tabs[0]!.id).toBeUndefined();
  });

  it("finds the sets of a project, by name", () => {
    const sets: TabSet[] = [
      { name: "Writing", tabs: [{ place: page("a.md"), pinned: false }], project: "trip" },
      { name: "Reading", tabs: [{ place: page("a.md"), pinned: false }], project: "trip" },
      { name: "Other", tabs: [{ place: page("a.md"), pinned: false }], project: "essay" },
      { name: "Free", tabs: [{ place: page("a.md"), pinned: false }] },
    ];
    expect(setsOfProject(sets, "trip").map((s) => s.name)).toEqual(["Reading", "Writing"]);
    expect(setsOfProject(sets, "nowhere")).toEqual([]);
  });
});
