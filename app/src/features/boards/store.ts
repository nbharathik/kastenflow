// The vault's whiteboards, for tabs, the Whiteboards view and pickers.
// Loaded when the vault opens and again whenever a board file changes.

import { create } from "zustand";

import type { BoardInfo, NoteMeta } from "../../lib/vault/types";
import { useWorkspace, type OpenHow } from "../workspace/store";
import { projects } from "../workspace/tree";

interface BoardsState {
  list: BoardInfo[];
  loaded: boolean;
  /** The Whiteboards view's "New whiteboard" form is open. */
  creating: boolean;
  /** The project the form starts with, when opened from one. */
  draftProject: string | null;
  /** The project the Whiteboards view shows only, asked for from a project's
   * home; the view takes it when it opens. */
  onlyProject: string | null;
  /** Reads the list again; the old one stays if that fails. */
  load(): Promise<void>;
}

/** The latest load; an older one answering later is dropped. */
let latest = 0;

export const useBoards = create<BoardsState>((set) => ({
  list: [],
  loaded: false,
  creating: false,
  draftProject: null,
  onlyProject: null,
  async load() {
    const client = useWorkspace.getState().client;
    if (!client) return;
    const mine = ++latest;
    try {
      const list = await client.boards();
      if (mine === latest) set({ list, loaded: true });
    } catch {
      // Keep what we had.
    }
  },
}));

/** Opens the Whiteboards view on its "New whiteboard" form, in `project` if
 * given, here or as `how` asks (a new tab, the pane to the right). */
export function startNewBoard(project: string | null = null, how: OpenHow = "here"): void {
  useWorkspace.getState().go({ view: "boards" }, how);
  useBoards.setState({ creating: true, draftProject: project });
}

/** Opens the Whiteboards view with only `project`'s boards, here or as `how` asks. */
export function showBoardsOf(project: string, how: OpenHow = "here"): void {
  useBoards.setState({ onlyProject: project });
  useWorkspace.getState().go({ view: "boards" }, how);
}

/** A board's title from the list, else its file name. */
export function boardTitle(list: readonly BoardInfo[], path: string): string {
  return list.find((b) => b.path === path)?.title ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.canvas$/, "");
}

/** A project folder's title, from its project page, else the folder name. */
export function projectTitle(notes: readonly NoteMeta[], folder: string): string {
  return projects(notes).find((p) => p.project === folder)?.title ?? folder;
}
