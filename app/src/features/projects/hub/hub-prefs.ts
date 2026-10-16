// What the Projects hub remembers in this window, for each vault: gallery or
// list, the sort and the status chip. A convenience: the projects themselves
// (their pins and order included) are the window preferences in
// `workspace/prefs.ts`, and a project's status is in its page.

import { create } from "zustand";

import { isLayout, isSort, isStatusFilter, type HubLayout, type SortId, type StatusFilter } from "./hub-model";

export interface HubPrefs {
  layout: HubLayout;
  sort: SortId;
  status: StatusFilter;
}

export const DEFAULT_HUB: HubPrefs = { layout: "gallery", sort: "manual", status: "all" };

const KEY = "kasten.projects-hub";

/** Takes only the valid parts of what was stored. */
export function readSaved(raw: unknown): HubPrefs {
  const saved = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    layout: isLayout(saved.layout) ? saved.layout : DEFAULT_HUB.layout,
    sort: isSort(saved.sort) ? saved.sort : DEFAULT_HUB.sort,
    status: isStatusFilter(saved.status) ? saved.status : DEFAULT_HUB.status,
  };
}

function all(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface HubPrefsState {
  /** The vault the choices are for, as its label names it. */
  vault: string;
  prefs: HubPrefs;
  /** Reads the choices made for this vault; the same vault again changes nothing. */
  open(vault: string): void;
  set(patch: Partial<HubPrefs>): void;
}

export const useHubPrefs = create<HubPrefsState>()((set, get) => ({
  vault: "",
  prefs: DEFAULT_HUB,
  open(vault) {
    if (vault === get().vault) return;
    set({ vault, prefs: readSaved(all()[vault]) });
  },
  set(patch) {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...all(), [get().vault]: prefs }));
    } catch {
      // The choices last until the window closes.
    }
  },
}));
