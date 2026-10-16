// "Add a paper" can be asked for from the palette, the References view, the
// page editor's citation menu, a browser tab and a PDF just imported. This is
// the one small store they all ask through; the dialog itself loads when it is
// first wanted (references/AddPaperHost.tsx).

import { create } from "zustand";

import type { PaperDraft } from "./draft";

export interface AddRequest {
  /** A draft to review at once (from a page, a PDF or the extension); without one the dialog asks for a paste. */
  draft?: PaperDraft;
  /** Words to start the paste box with. */
  text?: string;
  /** Called with the key once the reference is saved. */
  then?(key: string): void;
}

interface PaperDialogState {
  request: AddRequest | null;
  ask(request?: AddRequest): void;
  close(): void;
}

export const usePaperDialog = create<PaperDialogState>()((set) => ({
  request: null,
  ask: (request = {}) => set({ request }),
  close: () => set({ request: null }),
}));

/** Opens "Add a paper". */
export const openAddPaper = (request: AddRequest = {}): void => usePaperDialog.getState().ask(request);
