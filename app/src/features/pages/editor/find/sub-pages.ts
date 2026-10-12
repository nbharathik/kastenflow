// What the find bar asks of the workspace to look through a page and its
// sub-pages: the page provides it (workspace/page/sub-page-find.ts), so the
// editor reads and writes no vault itself.

import type { FindSpec, NoteMatches, Replaced, ReplaceRequest } from "../../../../lib/vault/types";
import type { LinkHow } from "../links";

export interface SubPageFind {
  /** The pages under this page (itself and its sub-pages, all the way down)
   * whose text or title holds `spec`, at most `max`. Writes nothing. */
  find(spec: FindSpec, max: number): Promise<NoteMatches[]>;
  /** Writes what is waiting in the open pages, then replaces in the pages the
   * preview showed, all or none, as one change the workspace's Undo takes
   * back. Refused with the core's "changed since the preview" when a page
   * differs from what was shown. */
  replace(request: Omit<ReplaceRequest, "root">): Promise<Replaced>;
  /** Opens the page at `path` with the find bar on `query`; `how` is where,
   * as the click's keys asked. */
  open(path: string, query: string, how?: LinkHow): void;
  /** Shows the Open menu for the page at `path` on a right-click; true when it did. */
  openMenu?(event: MouseEvent, path: string): boolean;
  /** Gives the page at `path` a new title (a title is never replaced in place:
   * a rename rewrites the links to the page). */
  rename(path: string, title: string): void;
}

/** How many pages the preview lists: the core's limit. */
export const MAX_PAGES = 200;
