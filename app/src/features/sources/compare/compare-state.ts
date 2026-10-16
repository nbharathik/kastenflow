// "Compare papers": a request from the References table, the Highlights view or
// the palette. This small store carries it to the dialog, which loads when it is
// first wanted (references/ResearchOverlays.tsx).

import { create } from "zustand";

export interface CompareRequest {
  /** References to start with, by citation key. */
  keys?: string[];
  /** PDFs in `sources/` to start with. */
  sources?: string[];
}

interface CompareDialogState {
  request: CompareRequest | null;
  ask(request?: CompareRequest): void;
  close(): void;
}

export const useCompareDialog = create<CompareDialogState>()((set) => ({
  request: null,
  ask: (request = {}) => set({ request }),
  close: () => set({ request: null }),
}));

/** Opens "Compare papers". */
export const openCompare = (request: CompareRequest = {}): void => useCompareDialog.getState().ask(request);
