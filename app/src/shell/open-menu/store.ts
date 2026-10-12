// The Open menu: one menu for anything that can be opened (a page, a
// project, a whiteboard, a deck, a PDF), shown where it was asked for.
// This is its state; `OpenMenuHost` draws it and `items.ts` builds it.

import { create } from "zustand";

import type { Place } from "../../features/workspace/tabs";

/** What can be opened: a vault path (a page, whiteboard, deck or PDF) or a place. */
export type OpenTarget = string | Place;

export interface OpenMenuState {
  /** Where the menu is, and what it opens; null while closed. */
  menu: { x: number; y: number; target: OpenTarget } | null;
  show(x: number, y: number, target: OpenTarget): void;
  close(): void;
}

export const useOpenMenu = create<OpenMenuState>()((set, get) => ({
  menu: null,
  show(x, y, target) {
    set({ menu: { x, y, target } });
  },
  close() {
    if (get().menu) set({ menu: null });
  },
}));
