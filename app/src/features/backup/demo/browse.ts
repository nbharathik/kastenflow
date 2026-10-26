// A pretend disk for the folder browser ("Choose folder…"): a home folder with
// the places people keep backups in. Nothing is read from this computer.

import type { FolderListing } from "../../../lib/api";

const HOME = "/Users/maya";

const TREE: Record<string, string[]> = {
  [HOME]: ["Desktop", "Documents", "Dropbox", "Google Drive", "OneDrive"],
  [`${HOME}/Documents`]: ["Backups", "Notes"],
  [`${HOME}/Dropbox`]: ["KastenFlow backups"],
  [`${HOME}/Google Drive`]: ["My Drive"],
  [`${HOME}/OneDrive`]: ["Documents"],
};

const parentOf = (path: string): string | null => (path === HOME ? null : path.slice(0, path.lastIndexOf("/")) || HOME);

/** The folders in `path` (the documents folder when none is given). */
export function listing(path?: string | null): FolderListing {
  const at = path && (path in TREE || path.startsWith(`${HOME}/`)) ? path : `${HOME}/Documents`;
  return {
    path: at,
    parent: parentOf(at),
    folders: (TREE[at] ?? []).map((name) => ({ name, path: `${at}/${name}`, kind: "folder" as const })),
    files: [],
    places: [
      { label: "Home", path: HOME },
      { label: "Documents", path: `${HOME}/Documents` },
      { label: "Desktop", path: `${HOME}/Desktop` },
    ],
  };
}
