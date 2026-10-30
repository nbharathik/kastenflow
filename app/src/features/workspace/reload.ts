// After a change that touched much of the vault at once (an import, or
// undoing one), every list the window keeps is read again.

import { useBoards } from "../boards/store";
import { useSources } from "../sources/store";
import { useTags } from "../tags/store";
import { useWorkspace } from "./store";

export async function reloadLists(): Promise<void> {
  await useWorkspace.getState().refresh();
  // A list that cannot be read keeps what the window had; each store says its own failure when asked.
  await Promise.all([useBoards.getState().load(), useTags.getState().load(), useSources.getState().loadList()]).catch(() => {});
}
