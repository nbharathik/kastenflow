// Opening the References view at one reference: a citation chip's "Open
// reference", the comparison builder's "Open", the "Open existing" of a
// duplicate. The view takes the request when it shows, and clears it.

import { create } from "zustand";

import { useWorkspace } from "../workspace/store";

interface ReferenceRequests {
  /** The key to select once the view is there. */
  key: string | null;
  clear(): void;
}

export const useReferenceRequests = create<ReferenceRequests>()((set) => ({ key: null, clear: () => set({ key: null }) }));

/** Opens the References view with the reference `key` selected. */
export function openReference(key: string): void {
  useReferenceRequests.setState({ key });
  useWorkspace.getState().go({ view: "references" });
}
