// Whether the storyboard dialog is open, and for which page. Tiny on purpose: the shell reads it at start-up, and the dialog (with the slide
// engine it uses) is loaded when it is first shown.

import type { StoryEntry } from "@kasten-slides/wasm";
import { create } from "zustand";

import type { NoteMeta } from "../../../../lib/vault/types";

/** What the dialog is asked to storyboard: a page, and the slides drafted from it. */
export interface StoryboardRequest {
  note: NoteMeta;
  entries: StoryEntry[];
}

interface StoryboardState {
  request: StoryboardRequest | null;
  show(request: StoryboardRequest): void;
  hide(): void;
}

export const useStoryboard = create<StoryboardState>((set) => ({
  request: null,
  show: (request) => set({ request }),
  hide: () => set({ request: null }),
}));
