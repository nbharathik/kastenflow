import { describe, expect, it } from "vitest";

import { activeTab, currentTab, focusedPane, initialLayout, navigate, openRight, openTab, split, togglePin, type Layout, type Place } from "./tabs";

const page = (path: string): Place => ({ view: "page", path });
const pathsIn = (layout: Layout, pane: number) => layout.panes[pane]!.tabs.map((t) => t.place.path ?? t.place.view);

/** One pane showing a.md. */
const single = () => navigate(initialLayout(), page("a.md"));

describe("open to the right", () => {
  it("splits when no pane is to the right, and focuses the new pane", () => {
    const l = openRight(single(), page("b.md"));
    expect(l.panes).toHaveLength(2);
    expect(pathsIn(l, 0)).toEqual(["a.md"]);
    expect(pathsIn(l, 1)).toEqual(["b.md"]);
    expect(focusedPane(l).id).toBe(l.panes[1]!.id);
  });

  it("replaces the tab in the pane to the right, keeping the way back there", () => {
    let l = openRight(single(), page("b.md"));
    // Back in the left pane, the next page goes to the right again.
    l = { ...l, focus: l.panes[0]!.id };
    l = openRight(l, page("c.md"));
    expect(l.panes).toHaveLength(2);
    expect(pathsIn(l, 1)).toEqual(["c.md"]);
    expect(activeTab(l.panes[1]!).back).toEqual([page("b.md")]);
    expect(l.focus).toBe(l.panes[1]!.id);
    // The left pane is untouched.
    expect(pathsIn(l, 0)).toEqual(["a.md"]);
  });

  it("adds a tab instead when asked not to replace", () => {
    let l = openRight(single(), page("b.md"));
    l = { ...l, focus: l.panes[0]!.id };
    l = openRight(l, page("c.md"), false);
    expect(pathsIn(l, 1)).toEqual(["b.md", "c.md"]);
    expect(currentTab(l).place).toEqual(page("c.md"));
  });

  it("keeps a pinned tab and adds a tab beside it", () => {
    let l = openRight(single(), page("b.md"));
    const right = l.panes[1]!;
    l = togglePin(l, right.id, activeTab(right).id);
    l = { ...l, focus: l.panes[0]!.id };
    l = openRight(l, page("c.md"));
    expect(pathsIn(l, 1)).toEqual(["b.md", "c.md"]);
    expect(l.panes[1]!.tabs[0]!.pinned).toBe(true);
    expect(currentTab(l).place).toEqual(page("c.md"));
  });

  it("selects the tab that already shows the page", () => {
    let l = openRight(single(), page("b.md"));
    l = openTab(l, page("c.md"));
    l = { ...l, focus: l.panes[0]!.id };
    const before = pathsIn(l, 1);
    l = openRight(l, page("b.md"));
    expect(pathsIn(l, 1)).toEqual(before);
    expect(currentTab(l).place).toEqual(page("b.md"));
    expect(l.focus).toBe(l.panes[1]!.id);
  });

  it("goes to the pane right of the focused one among three, and from the last one splits as split does", () => {
    let l = split(split(single(), page("b.md")), page("c.md"));
    expect(l.panes).toHaveLength(3);
    // From the first pane: the middle one.
    l = { ...l, focus: l.panes[0]!.id };
    l = openRight(l, page("d.md"));
    expect(pathsIn(l, 1)).toEqual(["d.md"]);
    expect(pathsIn(l, 2)).toEqual(["c.md"]);
    // From the last pane (no pane to its right), a third pane cannot be
    // added, so split opens a tab where it is.
    l = { ...l, focus: l.panes[2]!.id };
    l = openRight(l, page("e.md"));
    expect(l.panes).toHaveLength(3);
    expect(pathsIn(l, 2)).toEqual(["c.md", "e.md"]);
  });
});
