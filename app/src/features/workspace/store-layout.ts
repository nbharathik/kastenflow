// The store's tabs, panes and side stack: actions over `tabs.ts`, the
// layout kept in this browser so the window reopens as it was left.

import { usePeek } from "../peek/store";
import { usePrefs } from "./prefs";
import * as tabs from "./tabs";
import type { Layout, Place } from "./tabs";

/** How to open something: in the current tab, a new tab, a new pane
 * (`split`), the pane to the right of this one (`right`), the side stack
 * (Heptabase's card column), or a peek over the view: `peek` as Settings
 * chooses, `peek-side` and `peek-center` as asked (Notion's peeks). */
export type OpenHow = "here" | "tab" | "split" | "right" | "stack" | "peek" | "peek-side" | "peek-center";

const HOWS: readonly OpenHow[] = ["here", "tab", "split", "right", "stack", "peek", "peek-side", "peek-center"];

/** `how` when it is a way to open, else `here`: for the editor's own link
 * kinds (`LinkHow`) and the `opens` key of a page, which share these names. */
export const howFromName = (how: string | null | undefined): OpenHow => (HOWS.includes(how as OpenHow) ? (how as OpenHow) : "here");

type ClickKeys = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number };

/** The way a click asks to open: Ctrl or Cmd for a tab, Ctrl or Cmd with Alt
 * for the pane to the right, Shift for the stack, Alt for a split pane; the
 * middle button for a tab. */
export function howFrom(event: ClickKeys): OpenHow {
  if (event.button === 1) return "tab";
  if ((event.ctrlKey || event.metaKey) && event.altKey) return "right";
  if (event.ctrlKey || event.metaKey) return "tab";
  if (event.shiftKey) return "stack";
  if (event.altKey) return "split";
  return "here";
}

/** As `howFrom`, for a page picked in a view of many (a calendar, a
 * table, a board of cards): a plain click peeks at it, as in Notion. */
export function howFromView(event: ClickKeys): OpenHow {
  const how = howFrom(event);
  return how === "here" ? "peek" : how;
}

export interface LayoutState {
  layout: Layout;
  /** The focused tab's place and its way back and forward. */
  place: Place;
  back: Place[];
  forward: Place[];
  /** Notes open in the side stack, top first. */
  stack: string[];
  stackOpen: boolean;
  openTab(place: Place): void;
  /** Opens many places as tabs at once; `pinned` ones pinned. */
  openTabs(places: readonly Place[], pinned?: readonly Place[]): void;
  closeTab(paneId?: string, tabId?: string): void;
  /** Closes the unpinned tabs to the right of one. */
  closeRight(paneId: string, tabId: string): void;
  reopenTab(): void;
  selectTab(paneId: string, tabId: string): void;
  focusPane(paneId: string): void;
  splitRight(place?: Place): void;
  /** Opens a place in the pane to the right (Settings says whether it
   * replaces that pane's tab or adds one), or splits when there is none. */
  openRight(place: Place): void;
  closePane(paneId: string): void;
  /** Panes' shares of the width, by pane id. */
  resizePanes(sizes: Readonly<Record<string, number>>): void;
  cycleTab(step: 1 | -1): void;
  togglePin(paneId: string, tabId: string): void;
  moveTab(paneId: string, tabId: string, index: number): void;
  /** A browser tab went to an address: its place keeps it, with no step in its way back. */
  setWebUrl(tabId: string, url: string): void;
  openInStack(path: string): void;
  /** Puts pages on the side stack in the given order, first on top. */
  stackAll(paths: readonly string[]): void;
  /** Tabs, stack cards and the peek follow notes that moved, by path. */
  followMoves(moves: ReadonlyMap<string, string>): void;
  closeInStack(path: string): void;
  moveInStack(path: string, step: -1 | 1): void;
  toggleStack(open?: boolean): void;
  clearStack(): void;
}

const KEY = "kasten.layout";
/** Pages the side stack holds; opening more drops the oldest. */
export const MAX_STACK = 12;

interface Saved {
  layout: Layout;
  stack: string[];
  stackOpen: boolean;
}

export function loadLayout(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    if (saved?.layout?.panes?.length && saved.layout.panes.every((p) => p.tabs.length > 0)) {
      return { layout: saved.layout, stack: Array.isArray(saved.stack) ? saved.stack : [], stackOpen: Boolean(saved.stackOpen) };
    }
  } catch {
    // A broken saved layout starts afresh.
  }
  return { layout: tabs.initialLayout(), stack: [], stackOpen: false };
}

function saveLayout(state: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The layout is a convenience; losing it is fine.
  }
}

/** The fields derived from a layout, to set with it. */
export function derive(layout: Layout): Pick<LayoutState, "layout" | "place" | "back" | "forward"> {
  const tab = tabs.currentTab(layout);
  return { layout, place: tab.place, back: tab.back, forward: tab.forward };
}

type Set = (partial: Partial<LayoutState> | ((s: LayoutState) => Partial<LayoutState>)) => void;
type Get = () => LayoutState & { recentVisit(place: Place): void };

/** The layout actions, for the workspace store. */
export function layoutSlice(set: Set, get: Get) {
  const apply = (next: Layout) => {
    set(derive(next));
    const { stack, stackOpen } = get();
    saveLayout({ layout: next, stack, stackOpen });
  };
  const stackChange = (stack: string[], stackOpen: boolean) => {
    set({ stack, stackOpen });
    saveLayout({ layout: get().layout, stack, stackOpen });
  };
  return {
    apply,
    actions: {
      openTab(place: Place) {
        apply(tabs.openTab(get().layout, place));
        get().recentVisit(place);
      },
      openTabs(places: readonly Place[], pinned: readonly Place[] = []) {
        apply(tabs.openTabs(get().layout, places, pinned));
      },
      closeRight(paneId: string, tabId: string) {
        apply(tabs.closeRight(get().layout, paneId, tabId));
      },
      closeTab(paneId?: string, tabId?: string) {
        const { layout } = get();
        const pane = paneId ? (layout.panes.find((p) => p.id === paneId) ?? tabs.focusedPane(layout)) : tabs.focusedPane(layout);
        apply(tabs.closeTab(layout, pane.id, tabId ?? pane.active));
      },
      reopenTab() {
        apply(tabs.reopenTab(get().layout));
      },
      selectTab(paneId: string, tabId: string) {
        apply(tabs.selectTab(get().layout, paneId, tabId));
      },
      focusPane(paneId: string) {
        if (get().layout.focus !== paneId) apply(tabs.focusPane(get().layout, paneId));
      },
      resizePanes(sizes: Readonly<Record<string, number>>) {
        apply(tabs.resizePanes(get().layout, sizes));
      },
      splitRight(place?: Place) {
        const target = place ?? get().place;
        apply(tabs.split(get().layout, target));
        get().recentVisit(target);
      },
      openRight(place: Place) {
        apply(tabs.openRight(get().layout, place, usePrefs.getState().rightReplaces));
        get().recentVisit(place);
      },
      closePane(paneId: string) {
        apply(tabs.closePane(get().layout, paneId));
      },
      cycleTab(step: 1 | -1) {
        apply(tabs.cycleTab(get().layout, step));
      },
      togglePin(paneId: string, tabId: string) {
        apply(tabs.togglePin(get().layout, paneId, tabId));
      },
      setWebUrl(tabId: string, url: string) {
        const next = tabs.setWebUrl(get().layout, tabId, url);
        if (next !== get().layout) apply(next);
      },
      moveTab(paneId: string, tabId: string, index: number) {
        apply(tabs.moveTab(get().layout, paneId, tabId, index));
      },
      openInStack(path: string) {
        // The stack holds pages; a board opens beside the current pane instead.
        if (path.endsWith(".canvas")) return get().splitRight({ view: "boards", path });
        if (path.endsWith(".deck")) return get().splitRight({ view: "slides", path });
        if (path.endsWith(".drawio")) return get().splitRight({ view: "diagrams", path });
        const stack = [path, ...get().stack.filter((p) => p !== path)].slice(0, MAX_STACK);
        stackChange(stack, true);
        get().recentVisit({ view: "page", path });
      },
      stackAll(paths: readonly string[]) {
        const pages = paths.filter((p) => !p.endsWith(".canvas") && !p.endsWith(".deck") && !p.endsWith(".drawio"));
        if (pages.length === 0) return;
        stackChange([...new Set([...pages, ...get().stack])].slice(0, MAX_STACK), true);
      },
      closeInStack(path: string) {
        const stack = get().stack.filter((p) => p !== path);
        stackChange(stack, stack.length > 0 && get().stackOpen);
      },
      moveInStack(path: string, step: -1 | 1) {
        const stack = [...get().stack];
        const at = stack.indexOf(path);
        const to = at + step;
        if (at < 0 || to < 0 || to >= stack.length) return;
        [stack[at], stack[to]] = [stack[to]!, stack[at]!];
        stackChange(stack, get().stackOpen);
      },
      toggleStack(open?: boolean) {
        stackChange(get().stack, open ?? !get().stackOpen);
      },
      clearStack() {
        stackChange([], false);
      },
      /** Tabs, stack cards and the peek follow notes that moved, by path. */
      followMoves(moves: ReadonlyMap<string, string>) {
        let layout = get().layout;
        for (const [from, to] of moves) layout = tabs.renamePath(layout, from, to);
        if (layout !== get().layout) apply(layout);
        const stack = get().stack.map((p) => moves.get(p) ?? p);
        if (stack.some((p, i) => p !== get().stack[i])) stackChange(stack, get().stackOpen);
        const peek = usePeek.getState().peek;
        const moved = peek && moves.get(peek.path);
        if (moved) usePeek.getState().open(moved, peek.mode);
      },
    },
  };
}
