// The right panel's tab and width, each pane's own: a panel
// starts on the last ones chosen, which the browser keeps like the theme,
// and changes only when it is changed itself.

import { create } from "zustand";

import { useShell } from "../../lib/store";
import { useWorkspace } from "../workspace/store";

/** Three tabs: the page's details (properties, outline and links, one under
 * the other), its history and its comments. */
export type PanelTab = "details" | "history" | "comments";

export const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "history", label: "History" },
  { id: "comments", label: "Comments" },
];

export const PANEL_WIDTH = { min: 240, max: 520, initial: 320 } as const;

/** The most of its page the panel takes, so the page stays readable in a
 * narrow pane. The width chosen is kept for when the pane is wide again. */
export const PANEL_SHARE = 0.45;

const TAB_KEY = "kasten.panel.tab";
const WIDTH_KEY = "kasten.panel.width";

const isTab = (value: unknown): value is PanelTab => PANEL_TABS.some((t) => t.id === value);

export const clampWidth = (width: number) => Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be off; the panel falls back to its defaults next time.
  }
}

interface PanelState {
  /** What a panel starts with: the tab and width chosen last. */
  tab: PanelTab;
  width: number;
  /** Each pane's own, by pane id, once chosen there. */
  tabs: Readonly<Record<string, PanelTab>>;
  widths: Readonly<Record<string, number>>;
  setTab(pane: string, tab: PanelTab): void;
  /** Sets a pane's width, within bounds; `remember` also makes it what
   * panels start with, and stores it (on drag end). */
  setWidth(pane: string, width: number, remember?: boolean): void;
}

function savedTab(): PanelTab {
  // A tab saved when properties, outline and links had a tab each opens as Details.
  const saved = load(TAB_KEY);
  return isTab(saved) ? saved : "details";
}

function savedWidth(): number {
  const saved = Number(load(WIDTH_KEY));
  return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : PANEL_WIDTH.initial;
}

/** `own` with every open panel that has no value of its own given the
 * starting one, so a new start does not change panels already open. */
function pinned<T>(own: Readonly<Record<string, T>>, start: T): Record<string, T> {
  const next = { ...own };
  for (const pane of useShell.getState().panels) next[pane] ??= start;
  return next;
}

export const usePanel = create<PanelState>()((set) => ({
  tab: savedTab(),
  width: savedWidth(),
  tabs: {},
  widths: {},
  setTab(pane, tab) {
    set((s) => ({ tab, tabs: { ...pinned(s.tabs, s.tab), [pane]: tab } }));
    keep(TAB_KEY, tab);
  },
  setWidth(pane, width, remember = false) {
    const next = clampWidth(width);
    set((s) => (remember ? { width: next, widths: { ...pinned(s.widths, s.width), [pane]: next } } : { widths: { ...s.widths, [pane]: next } }));
    if (remember) keep(WIDTH_KEY, String(next));
  },
}));

/** The tab `pane`'s panel shows. */
export const usePanelTab = (pane: string) => usePanel((s) => s.tabs[pane] ?? s.tab);

/** The width `pane`'s panel asks for; its page may show less (PANEL_SHARE). */
export const usePanelWidth = (pane: string) => usePanel((s) => s.widths[pane] ?? s.width);

/** Ctrl+Shift+H: the panel, open on the page's history. */
export function openHistory(): void {
  const pane = useWorkspace.getState().layout.focus;
  usePanel.getState().setTab(pane, "history");
  useShell.getState().openPanel(pane);
}

/** The panel, open on the page's comments. */
export function openComments(): void {
  const pane = useWorkspace.getState().layout.focus;
  usePanel.getState().setTab(pane, "comments");
  useShell.getState().openPanel(pane);
}
