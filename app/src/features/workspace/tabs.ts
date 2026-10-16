// Tabs and panes: every note or
// view opens in a tab; up to three panes sit side by side, each with its
// own tabs and its own back and forward. Pure functions over the layout,
// so the store stays small and this stays easy to test.

export type ViewId = "home" | "page" | "inbox" | "journal" | "calendar" | "library" | "tasks" | "trash" | "settings" | "boards" | "slides" | "diagrams" | "tags" | "highlights" | "chat" | "history" | "review" | "import" | "graph" | "overview" | "web" | "collections" | "projects" | "references" | "reviews";

export interface Place {
  view: ViewId;
  /** The open note, for `page`; the open collection's file, for `collections`. */
  path?: string;
  /** The address a browser tab shows, for `web`; none is its start page. */
  url?: string;
}

export interface Tab {
  id: string;
  place: Place;
  back: Place[];
  forward: Place[];
  pinned: boolean;
}

export interface Pane {
  id: string;
  tabs: Tab[];
  active: string;
  /** Its share of the width against the other panes; unset is 1. */
  size?: number;
}

export interface Layout {
  panes: Pane[];
  /** The pane keys and commands act on. */
  focus: string;
  /** Recently closed tabs' places, newest last, for Ctrl+Shift+T. */
  closed: Place[];
}

export const MAX_PANES = 3;
export const HOME: Place = { view: "home" };
const MAX_HISTORY = 100;
const MAX_CLOSED = 20;

let seq = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`;

export const samePlace = (a: Place, b: Place) => a.view === b.view && a.path === b.path && a.url === b.url;

/** A browser tab went to `url`: the tab's place says so without a step in its
 * way back (the page keeps its own history), so the tab reopens where it was. */
export function setWebUrl(layout: Layout, tabId: string, url: string): Layout {
  let found = false;
  const panes = layout.panes.map((pane) => ({
    ...pane,
    tabs: pane.tabs.map((tab) => {
      if (tab.id !== tabId || tab.place.view !== "web" || tab.place.url === url) return tab;
      found = true;
      return { ...tab, place: { ...tab.place, url } };
    }),
  }));
  return found ? { ...layout, panes } : layout;
}

/** With pages opening in new tabs (Settings), whether going from `current`
 * to `next` gets its own tab: a page, board, PDF or tag database does,
 * except the journal's days and a board entered from its parent board,
 * which are moves within one place. A view such as the Inbox does when it
 * would take the place of a page, and not when it follows another view. */
export function opensOwnTab(current: Place, next: Place): boolean {
  if (samePlace(current, next)) return false;
  if (!next.path) return Boolean(current.path);
  if (current.view === next.view && (next.view === "journal" || (next.view === "boards" && current.path))) return false;
  return true;
}

function newTab(place: Place): Tab {
  return { id: nextId("t"), place, back: [], forward: [], pinned: false };
}

function newPane(place: Place): Pane {
  const tab = newTab(place);
  return { id: nextId("p"), tabs: [tab], active: tab.id };
}

export function initialLayout(place: Place = HOME): Layout {
  const pane = newPane(place);
  return { panes: [pane], focus: pane.id, closed: [] };
}

export function focusedPane(layout: Layout): Pane {
  return layout.panes.find((p) => p.id === layout.focus) ?? layout.panes[0]!;
}

export function activeTab(pane: Pane): Tab {
  return pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0]!;
}

/** The focused pane's active tab. */
export function currentTab(layout: Layout): Tab {
  return activeTab(focusedPane(layout));
}

function withPane(layout: Layout, paneId: string, change: (pane: Pane) => Pane): Layout {
  return { ...layout, panes: layout.panes.map((p) => (p.id === paneId ? change(p) : p)) };
}

function withTab(pane: Pane, tabId: string, change: (tab: Tab) => Tab): Pane {
  return { ...pane, tabs: pane.tabs.map((t) => (t.id === tabId ? change(t) : t)) };
}

/** Goes to `place` in the focused tab (or in the active tab of the pane
 * `paneId`), keeping the way back. */
export function navigate(layout: Layout, place: Place, paneId = layout.focus): Layout {
  const pane = layout.panes.find((p) => p.id === paneId) ?? focusedPane(layout);
  const tab = activeTab(pane);
  if (samePlace(tab.place, place)) return layout;
  return withPane(layout, pane.id, (p) =>
    withTab(p, tab.id, (t) => ({ ...t, place, back: [...t.back, t.place].slice(-MAX_HISTORY), forward: [] })),
  );
}

export function goBack(layout: Layout): Layout {
  const pane = focusedPane(layout);
  const tab = activeTab(pane);
  const previous = tab.back.at(-1);
  if (!previous) return layout;
  return withPane(layout, pane.id, (p) => withTab(p, tab.id, (t) => ({ ...t, place: previous, back: t.back.slice(0, -1), forward: [t.place, ...t.forward] })));
}

export function goForward(layout: Layout): Layout {
  const pane = focusedPane(layout);
  const tab = activeTab(pane);
  const next = tab.forward[0];
  if (!next) return layout;
  return withPane(layout, pane.id, (p) => withTab(p, tab.id, (t) => ({ ...t, place: next, back: [...t.back, t.place], forward: t.forward.slice(1) })));
}

/** Opens `place` in a new tab after the active one, or selects the tab
 * already showing it in that pane. */
export function openTab(layout: Layout, place: Place, paneId = layout.focus): Layout {
  const pane = layout.panes.find((p) => p.id === paneId) ?? focusedPane(layout);
  const existing = pane.tabs.find((t) => samePlace(t.place, place));
  if (existing) return { ...withPane(layout, pane.id, (p) => ({ ...p, active: existing.id })), focus: pane.id };
  const tab = newTab(place);
  const at = pane.tabs.findIndex((t) => t.id === pane.active) + 1;
  const tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)];
  return { ...withPane(layout, pane.id, (p) => ({ ...p, tabs, active: tab.id })), focus: pane.id };
}

/** Opens many places at once in the focused pane, after its tabs, each
 * once; those in `pinned` open pinned. The first one opened is shown. */
export function openTabs(layout: Layout, places: readonly Place[], pinned: readonly Place[] = []): Layout {
  const pane = focusedPane(layout);
  const fresh: Tab[] = [];
  const pins = new Set<string>();
  for (const place of places) {
    if (pane.tabs.some((t) => samePlace(t.place, place)) || fresh.some((t) => samePlace(t.place, place))) continue;
    const tab = newTab(place);
    if (pinned.some((p) => samePlace(p, place))) {
      tab.pinned = true;
      pins.add(tab.id);
    }
    fresh.push(tab);
  }
  const shown = fresh[0] ?? pane.tabs.find((t) => places.some((p) => samePlace(t.place, p)));
  if (!shown) return layout;
  const all = [...pane.tabs, ...fresh];
  const tabs = [...all.filter((t) => t.pinned), ...all.filter((t) => !t.pinned)];
  return { ...withPane(layout, pane.id, (p) => ({ ...p, tabs, active: shown.id })), focus: pane.id };
}

/** Closes the unpinned tabs after `tabId` in its pane. */
export function closeRight(layout: Layout, paneId: string, tabId: string): Layout {
  const pane = layout.panes.find((p) => p.id === paneId);
  const at = pane?.tabs.findIndex((t) => t.id === tabId) ?? -1;
  if (!pane || at < 0) return layout;
  return pane.tabs.slice(at + 1).reduce((next, tab) => (tab.pinned ? next : closeTab(next, paneId, tab.id)), layout);
}

export function selectTab(layout: Layout, paneId: string, tabId: string): Layout {
  return { ...withPane(layout, paneId, (p) => ({ ...p, active: tabId })), focus: paneId };
}

export function focusPane(layout: Layout, paneId: string): Layout {
  return layout.panes.some((p) => p.id === paneId) ? { ...layout, focus: paneId } : layout;
}

/** Closes a tab (pinned ones stay). A pane's last tab closes the pane, or
 * in the only pane goes home. */
export function closeTab(layout: Layout, paneId: string, tabId: string): Layout {
  const pane = layout.panes.find((p) => p.id === paneId);
  const tab = pane?.tabs.find((t) => t.id === tabId);
  if (!pane || !tab || tab.pinned) return layout;
  const closed = [...layout.closed, tab.place].slice(-MAX_CLOSED);
  if (pane.tabs.length === 1) {
    if (layout.panes.length > 1) return { ...closePane(layout, paneId), closed };
    const fresh = newTab(HOME);
    return { ...withPane(layout, paneId, () => ({ ...pane, tabs: [fresh], active: fresh.id })), closed };
  }
  const index = pane.tabs.findIndex((t) => t.id === tabId);
  const tabs = pane.tabs.filter((t) => t.id !== tabId);
  const active = pane.active === tabId ? tabs[Math.min(index, tabs.length - 1)]!.id : pane.active;
  return { ...withPane(layout, paneId, (p) => ({ ...p, tabs, active })), closed };
}

/** Reopens the last closed tab in the focused pane. */
export function reopenTab(layout: Layout): Layout {
  const place = layout.closed.at(-1);
  if (!place) return layout;
  return { ...openTab(layout, place), closed: layout.closed.slice(0, -1) };
}

/** Opens `place` in a pane to the right of the focused one: a new pane
 * while there are fewer than three, else a new tab in the next pane. */
export function split(layout: Layout, place: Place): Layout {
  const index = layout.panes.findIndex((p) => p.id === layout.focus);
  if (layout.panes.length < MAX_PANES) {
    // The new pane takes half the width of the one it splits from.
    const from = layout.panes[index]!;
    const half = (from.size ?? 1) / 2;
    const pane = { ...newPane(place), size: half };
    const panes = [...layout.panes.slice(0, index), { ...from, size: half }, pane, ...layout.panes.slice(index + 1)];
    return { ...layout, panes, focus: pane.id };
  }
  const target = layout.panes[Math.min(index + 1, layout.panes.length - 1)]!;
  return openTab(layout, place, target.id);
}

/** Opens `place` in the pane to the right of the focused one, which takes
 * the focus. With `replace` it goes into that pane's active tab (a pinned
 * tab keeps its page: a new tab is added instead); without, a tab is added.
 * A tab already showing it is selected. With no pane to the right, the
 * focused pane splits, as `split` does. */
export function openRight(layout: Layout, place: Place, replace = true): Layout {
  const index = layout.panes.findIndex((p) => p.id === layout.focus);
  const right = layout.panes[index + 1];
  if (!right) return split(layout, place);
  const shown = right.tabs.find((t) => samePlace(t.place, place));
  if (shown) return { ...withPane(layout, right.id, (p) => ({ ...p, active: shown.id })), focus: right.id };
  if (replace && !activeTab(right).pinned) return { ...navigate(layout, place, right.id), focus: right.id };
  return openTab(layout, place, right.id);
}

export function closePane(layout: Layout, paneId: string): Layout {
  if (layout.panes.length === 1) return layout;
  const index = layout.panes.findIndex((p) => p.id === paneId);
  const closing = layout.panes[index];
  // Its width goes to the pane beside it, on the left when there is one.
  const heir = Math.max(0, index - 1);
  const panes = layout.panes
    .filter((p) => p.id !== paneId)
    .map((p, i) => (i === heir && closing ? { ...p, size: (p.size ?? 1) + (closing.size ?? 1) } : p));
  const focus = layout.focus === paneId ? panes[heir]!.id : layout.focus;
  return { ...layout, panes, focus };
}

/** Sets panes' shares of the width (see `Pane.size`); anything but a
 * positive number is left out. */
export function resizePanes(layout: Layout, sizes: Readonly<Record<string, number>>): Layout {
  const panes = layout.panes.map((p) => {
    const size = sizes[p.id];
    return size !== undefined && Number.isFinite(size) && size > 0 ? { ...p, size } : p;
  });
  return { ...layout, panes };
}

export function togglePin(layout: Layout, paneId: string, tabId: string): Layout {
  return withPane(layout, paneId, (p) => {
    const tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t));
    // Pinned tabs sit first.
    return { ...p, tabs: [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)] };
  });
}

/** The next or previous tab in the focused pane. */
export function cycleTab(layout: Layout, step: 1 | -1): Layout {
  const pane = focusedPane(layout);
  const index = pane.tabs.findIndex((t) => t.id === pane.active);
  const next = pane.tabs[(index + step + pane.tabs.length) % pane.tabs.length]!;
  return selectTab(layout, pane.id, next.id);
}

/** Moves a tab to `index` within its pane. */
export function moveTab(layout: Layout, paneId: string, tabId: string, index: number): Layout {
  return withPane(layout, paneId, (p) => {
    const tab = p.tabs.find((t) => t.id === tabId);
    if (!tab) return p;
    const rest = p.tabs.filter((t) => t.id !== tabId);
    const at = Math.max(0, Math.min(index, rest.length));
    return { ...p, tabs: [...rest.slice(0, at), tab, ...rest.slice(at)] };
  });
}

const renamePlace = (from: string, to: string) => (place: Place) => (place.path === from ? { ...place, path: to } : place);

/** Follows a note that moved to a new path in every tab. */
export function renamePath(layout: Layout, from: string, to: string): Layout {
  const move = renamePlace(from, to);
  return {
    ...layout,
    panes: layout.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => ({ ...t, place: move(t.place), back: t.back.map(move), forward: t.forward.map(move) })) })),
    closed: layout.closed.map(move),
  };
}

/** Forgets a note that went to the trash: tabs showing it step back, or go home. */
export function forgetPath(layout: Layout, path: string): Layout {
  const keep = (place: Place) => place.path !== path;
  return {
    ...layout,
    panes: layout.panes.map((p) => ({
      ...p,
      tabs: p.tabs.map((t) => {
        const back = t.back.filter(keep);
        const forward = t.forward.filter(keep);
        if (keep(t.place)) return { ...t, back, forward };
        return { ...t, place: back.at(-1) ?? HOME, back: back.slice(0, -1), forward };
      }),
    })),
    closed: layout.closed.filter(keep),
  };
}

/** Every note path open in some tab. */
export function openPaths(layout: Layout): string[] {
  return layout.panes.flatMap((p) => p.tabs.map((t) => t.place.path)).filter((p): p is string => Boolean(p));
}
