// The folders that hold LaTeX documents, as the app last said. `openKind`
// asks it whether a `.bib` file belongs to a document (a bibliography in a
// LaTeX folder opens in the editor; the vault's own reference list does not).

import { latexBackend } from "./backend";

let folders: string[] = [];

/** Reads the document folders from the app (quietly: a failed read keeps the old list). */
export async function refreshDocs(): Promise<void> {
  const backend = latexBackend();
  if (!backend) return;
  try {
    folders = (await backend.docs()).map((d) => d.folder);
  } catch {
    // Keeps the last list.
  }
}

export function rememberDocs(next: readonly string[]): void {
  folders = [...next];
}

/** Whether `path` lies inside a folder that holds a document. */
export const inLatexFolder = (path: string): boolean => folders.some((folder) => path.startsWith(`${folder}/`));

/** The document folder above `path`, innermost first. */
export function folderOf(path: string, all: readonly string[] = folders): string | null {
  let best: string | null = null;
  for (const folder of all) if (path.startsWith(`${folder}/`) && folder.length > (best?.length ?? 0)) best = folder;
  return best;
}
