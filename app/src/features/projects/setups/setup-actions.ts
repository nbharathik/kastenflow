// What saving, renaming and deleting a setup do from the app: each is one
// change in the core. Saving and deleting say so in a notice that offers Undo;
// a delete moves the setup to the trash, nothing is removed for good.

import type { SavedSetup, SetupInfo } from "../../../lib/vault/project-types";
import { useWorkspace } from "../../workspace/store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Saves the project as a setup. A refusal is thrown, for the dialog to show beside its fields. */
export async function saveAsSetup(folder: string, name: string, pages: string[]): Promise<SavedSetup> {
  const { client, toast } = useWorkspace.getState();
  if (!client) throw new Error("No vault is open");
  const saved = await client.saveProjectSetup(folder, name.trim(), pages);
  const commit = saved.commit;
  toast(
    `Saved the setup “${saved.name}”. Choose it when you start a new project.`,
    commit
      ? {
          label: "Undo",
          run: () =>
            void client.undoCommit(commit).then(
              () => useWorkspace.getState().toast(`Took the setup “${saved.name}” back`),
              (err: unknown) => useWorkspace.getState().toast(message(err)),
            ),
        }
      : undefined,
  );
  return saved;
}

/** Gives a saved setup another name; the notice says why when it cannot. */
export async function renameSavedSetup(setup: SetupInfo, name: string): Promise<SetupInfo | null> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return null;
  try {
    return await client.renameSetup(setup.id, name.trim());
  } catch (err) {
    toast(message(err));
    return null;
  }
}

/** Moves a saved setup to the trash, with an Undo; true when it went. */
export async function trashSavedSetup(setup: SetupInfo, afterUndo: () => void): Promise<boolean> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return false;
  try {
    const gone = await client.trashSetup(setup.id);
    const commit = gone.commit;
    toast(
      `Moved the setup “${setup.name}” to the trash`,
      commit
        ? {
            label: "Undo",
            run: () =>
              void client.undoCommit(commit).then(
                () => {
                  afterUndo();
                  useWorkspace.getState().toast(`Brought the setup “${setup.name}” back`);
                },
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
