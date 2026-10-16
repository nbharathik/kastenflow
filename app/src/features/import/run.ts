// The Import view's steps against the vault client: the plan, the import,
// and taking it back, each reloading what the window lists afterwards.

import { create } from "zustand";

import type { ImportOptions, ImportSummary, Imported } from "../../lib/vault/types";
import { reloadLists as reload } from "../workspace/reload";
import { useWorkspace } from "../workspace/store";

/** The import commit that was last taken back, so the view that shows it can stand down however it was undone (its button, or the notice's). */
export const useUndoneImport = create<{ commit: string | null }>()(() => ({ commit: null }));

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function client() {
  const found = useWorkspace.getState().client;
  if (!found) throw new Error("No vault is open");
  return found;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export const planImport = (source: string, options: ImportOptions): Promise<Outcome<ImportSummary>> => attempt(() => client().planImport(source, options));

export async function runImport(source: string, options: ImportOptions): Promise<Outcome<Imported>> {
  const done = await attempt(() => client().importNotes(source, options));
  if (done.ok) {
    await reload();
    useUndoneImport.setState({ commit: null });
    const { notes, project } = done.value.summary;
    const commit = done.value.commit;
    // One notice for the whole import, with the Undo that takes all of it back.
    useWorkspace.getState().toast(`Imported ${notes} note${notes === 1 ? "" : "s"} into “${project}”`, commit ? { label: "Undo", run: () => void undoImport(commit) } : undefined);
  }
  return done;
}

/** Takes the import back; its error says what stopped it. */
export async function undoImport(commit: string): Promise<Outcome<null>> {
  const undone = await attempt(() => client().undoCommit(commit));
  if (!undone.ok) return undone;
  const conflict = undone.value.conflict;
  if (conflict) return { ok: false, error: `${conflict.path} changed since the import (${conflict.detail.toLowerCase()}), so nothing was undone. Undo that change first, or trash what you no longer want.` };
  await reload();
  useUndoneImport.setState({ commit });
  useWorkspace.getState().toast("The import is undone");
  return { ok: true, value: null };
}

/** "8 notes, 2 journal days, 1 board and 3 files" */
export function counts(s: ImportSummary): string {
  const parts = [
    [s.notes, "note"],
    [s.days + s.daysAppended, "journal day"],
    [s.boards, "board"],
    [s.files, "file"],
    [s.tags, "tag"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
  if (parts.length === 0) return "nothing";
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
