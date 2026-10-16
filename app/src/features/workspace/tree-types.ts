// What the sidebar's index (tree.ts) holds, and where a note counts as
// sitting outside Kasten's own folders.

import type { NoteMeta } from "../../lib/vault/types";

/** Kasten's own top-level folders. Notes in any
 * other folder, as in an Obsidian vault opened as it is, keep their folders
 * in the sidebar. */
export const KASTEN_FOLDERS = new Set(["inbox", "journal", "projects", "library", "sources", "chats", "templates", "tags", "assets"]);

/** Whether a note sits in a folder that is not one of Kasten's own. */
export function inOtherFolder(path: string): boolean {
  const slash = path.indexOf("/");
  return slash > 0 && !path.startsWith(".") && !KASTEN_FOLDERS.has(path.slice(0, slash));
}

/** A folder of notes outside Kasten's own folders. */
export interface FolderNode {
  name: string;
  /** Its vault path, such as `Areas/Health`; "" for the vault itself. */
  path: string;
  folders: FolderNode[];
  notes: NoteMeta[];
  /** Notes in it and in its folders. */
  count: number;
}

export interface TreeIndex {
  byPath: Map<string, NoteMeta>;
  byId: Map<string, NoteMeta>;
  /** Sub-pages by their parent's id, by title. */
  children: Map<string, NoteMeta[]>;
  /** A project's own top-level pages, then cards, by project folder. */
  projectPages: Map<string, NoteMeta[]>;
  /** Project notes by folder. */
  projectNote: Map<string, NoteMeta>;
  projects: NoteMeta[];
  loose: NoteMeta[];
  /** Notes in other folders, by folder. */
  folders: FolderNode;
  inbox: NoteMeta[];
  journal: NoteMeta[];
  templates: NoteMeta[];
  openable: NoteMeta[];
  /** Openable notes by lower-case title, the first by path winning. */
  titles: Map<string, NoteMeta>;
}
