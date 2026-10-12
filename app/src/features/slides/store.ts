// The vault's slide decks, for tabs, the Slides view and the sidebar. Loaded
// when the vault opens and again whenever a deck file changes.

import { create } from "zustand";

import type { DeckInfo } from "../../lib/vault/types";
import { useWorkspace, type OpenHow } from "../workspace/store";

interface DecksState {
  list: DeckInfo[];
  /** The slide templates kept in the vault (`templates/slides/`), by title: the person's own, beside the built-in ones. */
  templates: DeckInfo[];
  loaded: boolean;
  /** The Slides view's "New deck" form is open. */
  creating: boolean;
  /** The project the form starts with, when opened from one. */
  draftProject: string | null;
  /** Reads the list again; the old one stays if that fails. */
  load(): Promise<void>;
}

/** The latest load; an older one answering later is dropped. */
let latest = 0;

export const useDecks = create<DecksState>((set) => ({
  list: [],
  templates: [],
  loaded: false,
  creating: false,
  draftProject: null,
  async load() {
    const client = useWorkspace.getState().client;
    if (!client) return;
    const mine = ++latest;
    try {
      // The templates come with the decks: one trigger (a deck file changed) keeps both lists right. A vault that keeps none says so with an empty list.
      const [list, templates] = await Promise.all([client.decks(), client.deckTemplates?.().catch(() => []) ?? []]);
      if (mine === latest) set({ list, templates, loaded: true });
    } catch {
      // Keep what we had.
    }
  },
}));

/** Opens the Slides view on its "New deck" form, in `project` if given, here
 * or as `how` asks (a new tab, the pane to the right). */
export function startNewDeck(project: string | null = null, how: OpenHow = "here"): void {
  useWorkspace.getState().go({ view: "slides" }, how);
  useDecks.setState({ creating: true, draftProject: project });
}

/** A deck's title from the list, else its file name. */
export function deckTitle(list: readonly DeckInfo[], path: string): string {
  return list.find((d) => d.path === path)?.title ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.deck$/, "");
}
