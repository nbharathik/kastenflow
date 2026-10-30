// Tab sets: tabs saved under a name, to open again together later (a window
// preference). A set may also keep the window's arrangement (its panes, their
// widths, the sidebar and the right panel) and belong to a project. Pinned
// tabs come back pinned; a page is found again by its id if it was moved or
// renamed meanwhile. Pure.

import type { NoteMeta } from "../../lib/vault/types";
import { MAX_PANES, samePlace, type Layout, type Pane, type Place } from "./tabs";

/** A tab in a set: where it was, whether it was pinned and, for a page, its id (so it is found if it moves). */
export interface SetTab {
  place: Place;
  pinned: boolean;
  id?: string;
}

/** A pane of a saved arrangement: which of the set's tabs it holds (by index) and its share of the width. */
export interface SetPane {
  tabs: number[];
  size?: number;
}

/** The arrangement a set keeps when it is saved with its layout. */
export interface SetLayout {
  panes: SetPane[];
  sidebarWidth?: number;
  sidebarOpen?: boolean;
  right?: { open: boolean; width?: number; tab?: string };
}

export interface TabSet {
  name: string;
  tabs: SetTab[];
  /** The panes and panels as they were; none for a set of one pane's tabs. */
  layout?: SetLayout;
  /** The project folder (under `projects/`) the set belongs to. */
  project?: string;
}

const VIEWS = new Set(["home", "page", "inbox", "journal", "calendar", "library", "tasks", "trash", "settings", "boards", "slides", "tags", "highlights", "chat", "history", "review", "import", "graph", "overview", "collections", "projects", "references", "reviews", "web"]);

/** The most tabs one set keeps, so a stored set stays small. */
export const MAX_SET_TABS = 60;
const MAX_URL = 2048;
const SIDEBAR_WIDTH = { min: 160, max: 640 };

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

/** The id of the page `place` shows, as the notes say. */
function idOf(place: Place, notes: readonly NoteMeta[]): string | undefined {
  if (!place.path?.endsWith(".md")) return undefined;
  return notes.find((n) => n.path === place.path)?.id ?? undefined;
}

function tabOf(place: Place, pinned: boolean, notes: readonly NoteMeta[]): SetTab {
  const id = idOf(place, notes);
  return { place: { ...place }, pinned, ...(id ? { id } : {}) };
}

/** The pane's tabs as a set called `name`: Home left out, each place once. */
export function setOf(pane: Pane, name: string, notes: readonly NoteMeta[] = [], project?: string): TabSet | null {
  const tabs: SetTab[] = [];
  for (const tab of pane.tabs) {
    if (tab.place.view === "home" || tabs.some((t) => samePlace(t.place, tab.place))) continue;
    tabs.push(tabOf(tab.place, tab.pinned, notes));
  }
  const title = cleanName(name);
  return title && tabs.length > 0 && tabs.length <= MAX_SET_TABS ? { name: title, tabs, ...(project ? { project } : {}) } : null;
}

/** What the window looks like outside its tabs, for a set saved with its layout. */
export interface Arrangement {
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** The right panel of the focused pane. */
  right?: { open: boolean; width?: number; tab?: string };
}

/** Every pane's tabs, the panes' shares and the panels as a set called `name`. Home is left out, each place once (a place in two panes is one tab both panes hold); a pane with only Home is left out too. */
export function setOfWindow(layout: Layout, name: string, notes: readonly NoteMeta[], arrangement: Arrangement, project?: string): TabSet | null {
  const tabs: SetTab[] = [];
  const panes: SetPane[] = [];
  for (const pane of layout.panes) {
    const held: number[] = [];
    for (const tab of pane.tabs) {
      if (tab.place.view === "home") continue;
      let at = tabs.findIndex((t) => samePlace(t.place, tab.place));
      if (at < 0) {
        at = tabs.length;
        tabs.push(tabOf(tab.place, tab.pinned, notes));
      } else if (tab.pinned) {
        tabs[at]!.pinned = true;
      }
      if (!held.includes(at)) held.push(at);
    }
    if (held.length > 0) panes.push({ tabs: held, ...(pane.size !== undefined ? { size: pane.size } : {}) });
  }
  const title = cleanName(name);
  if (!title || tabs.length === 0 || tabs.length > MAX_SET_TABS || panes.length === 0) return null;
  const layoutOut: SetLayout = {
    panes,
    sidebarOpen: arrangement.sidebarOpen,
    sidebarWidth: Math.round(arrangement.sidebarWidth),
    ...(arrangement.right ? { right: arrangement.right } : {}),
  };
  return { name: title, tabs, layout: layoutOut, ...(project ? { project } : {}) };
}

/** `sets` with `set` in it, replacing one of the same name. */
export function withSet(sets: readonly TabSet[], set: TabSet): TabSet[] {
  const same = (s: TabSet) => s.name.toLowerCase() === set.name.toLowerCase();
  return sets.some(same) ? sets.map((s) => (same(s) ? set : s)) : [...sets, set];
}

export const withoutSet = (sets: readonly TabSet[], name: string) => sets.filter((s) => s.name !== name);

/** The sets that belong to the project in this folder, by name. */
export const setsOfProject = (sets: readonly TabSet[], folder: string): TabSet[] => sets.filter((s) => s.project === folder).sort((a, b) => a.name.localeCompare(b.name));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readTab(raw: unknown): SetTab | null {
  if (!isRecord(raw) || !isRecord(raw.place)) return null;
  const { view: saved, path, url } = raw.place;
  if (typeof saved !== "string") return null;
  // Diagrams were a view of their own before they became a plugin's; a plugin's view is kept (it shows Home while the plugin is off).
  const view = saved === "diagrams" ? "plugin:diagrams" : saved;
  if (!VIEWS.has(view) && !/^plugin:[\w-]+$/.test(view)) return null;
  if (path !== undefined && typeof path !== "string") return null;
  if (url !== undefined && (typeof url !== "string" || url.length > MAX_URL || !/^https?:\/\//i.test(url))) return null;
  const place: Place = { view: view as Place["view"], ...(path ? { path } : {}), ...(url ? { url } : {}) };
  return { place, pinned: Boolean(raw.pinned), ...(typeof raw.id === "string" && raw.id ? { id: raw.id } : {}) };
}

function readLayout(raw: unknown, count: number): SetLayout | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.panes)) return undefined;
  const panes: SetPane[] = [];
  for (const pane of raw.panes) {
    if (!isRecord(pane) || !Array.isArray(pane.tabs)) return undefined;
    const held = [...new Set(pane.tabs.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < count))];
    if (held.length === 0) continue;
    panes.push({ tabs: held, ...(typeof pane.size === "number" && Number.isFinite(pane.size) && pane.size > 0 ? { size: pane.size } : {}) });
  }
  if (panes.length === 0 || panes.length > MAX_PANES) return undefined;
  const layout: SetLayout = { panes };
  if (typeof raw.sidebarOpen === "boolean") layout.sidebarOpen = raw.sidebarOpen;
  if (typeof raw.sidebarWidth === "number" && Number.isFinite(raw.sidebarWidth)) layout.sidebarWidth = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, raw.sidebarWidth)));
  if (isRecord(raw.right) && typeof raw.right.open === "boolean") {
    const { open, width, tab } = raw.right;
    layout.right = { open, ...(typeof width === "number" && Number.isFinite(width) && width > 0 ? { width } : {}), ...(typeof tab === "string" && tab ? { tab } : {}) };
  }
  return layout;
}

/** Sets as stored, keeping only well-formed ones. Sets saved before layouts, projects and ids existed read as they were; a layout that does not hold together is left out and the tabs remain. */
export function readSets(value: unknown): TabSet[] {
  if (!Array.isArray(value)) return [];
  const out: TabSet[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string" || !Array.isArray(item.tabs)) continue;
    const tabs = item.tabs.map(readTab).filter((t): t is SetTab => t !== null).slice(0, MAX_SET_TABS);
    if (tabs.length === 0) continue;
    // Tab numbers in a layout count the tabs as stored: if one was dropped they no longer line up.
    const layout = tabs.length === item.tabs.length ? readLayout(item.layout, tabs.length) : undefined;
    const project = typeof item.project === "string" && /^[^/\\:.][^/\\:]*$/.test(item.project) ? item.project : undefined;
    out.push({ name: item.name, tabs, ...(layout ? { layout } : {}), ...(project ? { project } : {}) });
  }
  return out;
}
