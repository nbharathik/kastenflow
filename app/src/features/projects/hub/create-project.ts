// Making a project from the hub: a blank one, or one that starts from a setup
// (a few pages, a whiteboard, sometimes a deck). Either way it opens, and the
// notice offers Undo: a setup is one commit that Undo takes back, a blank
// project goes to the trash.

import type { SetupInfo } from "../../../lib/vault/project-types";
import { useDecks } from "../../slides/store";
import { flushOpenPage } from "../../workspace/page/open-page";
import { reloadLists } from "../../workspace/reload";
import { useWorkspace } from "../../workspace/store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads every list that a setup may have added to. */
async function reloadAll(): Promise<void> {
  await reloadLists();
  await useDecks.getState().load();
}

/** Makes the project and opens it; false when the core refused (the notice says why). */
export async function createProject(choice: "blank" | SetupInfo, title: string): Promise<boolean> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return false;
  const name = title.trim();
  try {
    // Typing waiting to be written goes first, as its own change.
    await flushOpenPage();
    if (choice === "blank") {
      // A project starts blank; "/" then "Template…" in its empty page fills it from one.
      const made = await useWorkspace.getState().create({ kind: "project", title: name, template: null });
      if (!made) return false;
      toast(`Created “${name}”`, { label: "Undo", run: () => void useWorkspace.getState().trash(made.meta.path) });
      return true;
    }
    const applied = await client.applySetup(choice.id, { kind: "new", title: name });
    await reloadAll();
    useWorkspace.getState().openPath(applied.home);
    const commit = applied.commit;
    toast(
      `Created “${name}” from ${choice.name}`,
      commit
        ? {
            label: "Undo",
            run: () =>
              void client
                .undoCommit(commit)
                .then(reloadAll)
                .then(
                  () => useWorkspace.getState().toast(`Took “${name}” back out`),
                  (err: unknown) => useWorkspace.getState().toast(message(err)),
                ),
          }
        : undefined,
    );
    return true;
  } catch (err) {
    toast(message(err));
    return false;
  }
}
