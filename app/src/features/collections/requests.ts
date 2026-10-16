// Asking for a new collection from anywhere (the palette, the Library's
// result bar): the request waits here and the Collections view, opened for
// it, shows the dialog.

import { create } from "zustand";

import { useWorkspace } from "../workspace/store";
import type { SavedSearch } from "./from-search";

interface Requests {
  /** What the dialog starts from; null for none asked. */
  pending: SavedSearch | null;
  ask(saved: SavedSearch): void;
  clear(): void;
}

export const useCollectionRequests = create<Requests>()((set) => ({
  pending: null,
  ask: (saved) => set({ pending: saved }),
  clear: () => set({ pending: null }),
}));

/** Opens the Collections view with the dialog for a new collection. */
export function newCollection(saved: SavedSearch = { edits: { query: "" }, name: "", dropped: [] }): void {
  useCollectionRequests.getState().ask(saved);
  useWorkspace.getState().go({ view: "collections" });
}

/** Opens the Collections view with the dialog for a new collection that keeps this search (the palette's, as typed). */
export function newCollectionFromQuery(text: string): void {
  const query = text.trim();
  newCollection({ edits: { query }, name: query.length > 40 ? `${query.slice(0, 39)}…` : query, dropped: [] });
}

/** Opens the collection at `path`. */
export function openCollection(path: string): void {
  useWorkspace.getState().go({ view: "collections", path });
}
