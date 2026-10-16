// Bringing a saved tab set back. Nothing already open is closed (so a page
// with edits not yet saved stays open); a tab already open is not opened
// twice; a page that was moved or renamed is found by its id; one that is
// gone is still opened and said to be missing, so the rest comes back; a
// browser tab comes back as an entry that loads its page only when it is the
// tab shown.

import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";
import { usePanel, type PanelTab } from "../panel/panel-store";
import { usePrefs } from "./prefs";
import { useWorkspace } from "./store";
import { setsOfProject, type Arrangement, type SetLayout, type SetTab, type TabSet } from "./tab-sets";
import { focusedPane, MAX_PANES, samePlace, type Place } from "./tabs";

export interface ResolvedTab {
  place: Place;
  pinned: boolean;
  /** The page is not among the notes (and none carries its id). */
  missing: boolean;
}

/** Where a saved tab is now: a page that has an id is found by it, whatever its path has become; one without is where it was. */
export function resolveTab(tab: SetTab, notes: readonly NoteMeta[]): ResolvedTab {
  const { place } = tab;
  if (!place.path?.endsWith(".md")) return { place, pinned: tab.pinned, missing: false };
  const byId = tab.id ? notes.find((n) => n.id === tab.id) : undefined;
  const there = byId ?? notes.find((n) => n.path === place.path);
  return { place: there && there.path !== place.path ? { ...place, path: there.path } : place, pinned: tab.pinned, missing: !there };
}

/** The tabs of a pane, a browser tab after the others, so the first one shown is a page: a browser tab loads when it is selected. */
export function paneOrder(places: readonly Place[]): Place[] {
  return [...places.filter((p) => p.view !== "web"), ...places.filter((p) => p.view === "web")];
}

export interface Restored {
  /** Places the set held. */
  tabs: number;
  /** Pages that could not be found, as saved (their titles, else their paths). */
  missing: string[];
}

const nameOf = (tab: SetTab) => tab.place.path?.split("/").pop()?.replace(/\.md$/, "") ?? tab.place.view;

function shell(layout: SetLayout, paneId: string): void {
  if (layout.sidebarOpen !== undefined) useShell.setState({ sidebarOpen: layout.sidebarOpen });
  if (layout.sidebarWidth !== undefined) usePrefs.getState().set({ sidebarWidth: layout.sidebarWidth });
  if (layout.right?.open) {
    useShell.getState().openPanel(paneId);
    if (layout.right.tab === "details" || layout.right.tab === "history" || layout.right.tab === "comments") usePanel.getState().setTab(paneId, layout.right.tab as PanelTab);
    if (layout.right.width !== undefined) usePanel.getState().setWidth(paneId, layout.right.width);
  }
}

/** Opens a set's tabs: in the focused pane, or, for a set saved with its layout, in the panes it had (a pane that already holds the first of a saved pane's tabs is used instead of a new one, so a set restored twice is the same window). */
export function restoreSet(set: TabSet): Restored {
  const workspace = useWorkspace.getState();
  const resolved = set.tabs.map((tab) => resolveTab(tab, workspace.notes));
  const missing = set.tabs.filter((_, i) => resolved[i]!.missing).map(nameOf);
  const pinnedIn = (indexes: readonly number[]) => indexes.filter((i) => resolved[i]!.pinned).map((i) => resolved[i]!.place);
  const all = set.tabs.map((_, i) => i);
  /** Shows the tab for `place` in the focused pane: a browser tab, or whatever was already open, never takes the pane over. */
  const show = (place: Place) => {
    const { layout } = useWorkspace.getState();
    const pane = focusedPane(layout);
    const tab = pane.tabs.find((t) => samePlace(t.place, place));
    if (tab) useWorkspace.getState().selectTab(pane.id, tab.id);
  };
  if (!set.layout) {
    const places = paneOrder(all.map((i) => resolved[i]!.place));
    workspace.openTabs(places, pinnedIn(all));
    show(places[0]!);
    return { tabs: set.tabs.length, missing };
  }
  const touched: { id: string; size: number | undefined }[] = [];
  for (const saved of set.layout.panes.slice(0, MAX_PANES)) {
    const places = paneOrder(saved.tabs.map((i) => resolved[i]!.place));
    const pinned = pinnedIn(saved.tabs);
    const layout = useWorkspace.getState().layout;
    const holder = layout.panes.find((pane) => pane.tabs.some((tab) => samePlace(tab.place, places[0]!)));
    // The first pane of the set goes in the pane in front; a later one in its own, unless it is there already.
    if (holder) useWorkspace.getState().focusPane(holder.id);
    else if (touched.length > 0) useWorkspace.getState().splitRight(places[0]!);
    useWorkspace.getState().openTabs(places, pinned);
    show(places[0]!);
    touched.push({ id: useWorkspace.getState().layout.focus, size: saved.size });
  }
  const arranged = useWorkspace.getState().layout;
  // Widths only make sense when the window now holds the panes of the set and no others.
  if (arranged.panes.length === touched.length && touched.every((t) => t.size !== undefined)) {
    useWorkspace.getState().resizePanes(Object.fromEntries(touched.map((t) => [t.id, t.size!])));
  }
  shell(set.layout, touched.at(-1)?.id ?? arranged.focus);
  return { tabs: set.tabs.length, missing };
}

/** The window outside its tabs as it is now, for saving a set with its layout. */
export function currentArrangement(): Arrangement {
  const { sidebarOpen, panels } = useShell.getState();
  const focus = useWorkspace.getState().layout.focus;
  const panel = usePanel.getState();
  return {
    sidebarOpen,
    sidebarWidth: usePrefs.getState().sidebarWidth,
    right: { open: panels.includes(focus), width: panel.widths[focus] ?? panel.width, tab: panel.tabs[focus] ?? panel.tab },
  };
}

/** The sets that belong to the project in this folder, for "Resume workspace" on its card and overview. */
export function workspacesOf(project: string): TabSet[] {
  return setsOfProject(usePrefs.getState().tabSets, project);
}

/** Restores a set and says what could not be found. */
export function resumeSet(set: TabSet): Restored {
  const restored = restoreSet(set);
  if (restored.missing.length > 0) {
    const names = restored.missing.slice(0, 3).join(", ");
    const more = restored.missing.length > 3 ? ` and ${restored.missing.length - 3} more` : "";
    useWorkspace.getState().toast(`Opened “${set.name}”. Not found, so shown empty: ${names}${more}. They may have been moved to the trash`);
  }
  return restored;
}
