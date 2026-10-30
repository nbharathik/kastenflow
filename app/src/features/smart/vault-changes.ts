// "The vault changed": the core bumps its counters after every change to a
// file of the vault, whoever made it, and the window follows them
// (`features/workspace/revision.ts`). A smart page's watches re-run on that.

import { useRevision } from "../workspace/revision";

/** Calls `listener` whenever any file of the vault changes (or another vault is opened); gives the way to stop. */
export function onVaultChange(listener: () => void): () => void {
  return useRevision.subscribe((state, previous) => {
    if (state.revision.epoch !== previous.revision.epoch || state.revision.all !== previous.revision.all) listener();
  });
}
