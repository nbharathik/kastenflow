// Choosing a page of the vault for a deck (Insert → Page…): the Slides host asks, a modal in the deck's view answers.

import type { HostPage } from "@kasten-slides/react";
import { create } from "zustand";

import { lineIconName } from "../../ui/glyph";
import { titleOf } from "../workspace/names";
import type { NoteMeta } from "../../lib/vault/types";

interface PickerState {
  /** Someone is waiting for a page to be chosen: how the choice is told to them. */
  waiting: ((page: HostPage | null) => void) | null;
  /** Asks the person to choose a page; resolves to null when they close the picker. One at a time: asking again cancels the first. */
  ask(): Promise<HostPage | null>;
  answer(page: HostPage | null): void;
}

export const usePagePicker = create<PickerState>((set, get) => ({
  waiting: null,
  ask: () =>
    new Promise<HostPage | null>((resolve) => {
      get().waiting?.(null);
      set({ waiting: resolve });
    }),
  answer(page) {
    const waiting = get().waiting;
    set({ waiting: null });
    waiting?.(page);
  },
}));

/** A note as the Slides host names a page. */
export function hostPage(note: NoteMeta): HostPage {
  return {
    path: note.path,
    ...(note.id ? { id: note.id } : {}),
    title: titleOf(note),
    // A deck keeps an emoji; the line icons a page may have are the app's own drawings and mean nothing outside it.
    ...(note.icon && !lineIconName(note.icon) ? { icon: note.icon } : {}),
    project: note.project,
    modified: note.modified,
    ...(note.excerpt ? { excerpt: note.excerpt } : {}),
  };
}

/** The notes a deck may use as pages: everything but templates. */
export const isPage = (note: NoteMeta): boolean => note.kind !== "template";
