// One controller per board path, shared by the tab and by every page that
// shows the board, so the undo history survives a remount (a tab switch, a
// page embed that scrolls away and back). The last user to let go starts a
// grace period; when it runs out the controller is released and its history
// goes. Keyed by path, so two boards are never mixed: a renamed board is a
// new path (rekeyBoard drops the old key at once).

import type { BoardController } from "./controller";

/** How long a board with no users keeps its controller, in milliseconds. */
export const GRACE_MS = 30_000;

interface Entry {
  board: Promise<BoardController>;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
  owner: object;
}

const entries = new Map<string, Entry>();

export interface Lease {
  /** The shared controller; rejects when the board could not be read. */
  board: Promise<BoardController>;
  /** Lets go. Safe to call twice. */
  release(): void;
}

/** Takes a share of the controller for `path`, making it with `load` when none is held. */
export function leaseBoard(path: string, load: () => Promise<BoardController>, owner: object = entries): Lease {
  let entry = entries.get(path);
  // Another vault (a different client) never shares a controller.
  if (entry && entry.owner !== owner) {
    if (entry.timer) clearTimeout(entry.timer);
    entries.delete(path);
    entry = undefined;
  }
  if (!entry) {
    const made: Entry = { board: load(), users: 0, timer: null, owner };
    made.board.catch(() => {
      if (entries.get(path) === made) entries.delete(path);
    });
    entries.set(path, made);
    entry = made;
  }
  const held = entry;
  if (held.timer) clearTimeout(held.timer);
  held.timer = null;
  held.users++;
  let done = false;
  return {
    board: held.board,
    release() {
      if (done) return;
      done = true;
      held.users--;
      if (held.users > 0 || held.timer) return;
      held.timer = setTimeout(() => {
        if (entries.get(path) === held && held.users === 0) entries.delete(path);
      }, GRACE_MS);
    },
  };
}

/** The board at `path` was renamed or moved: nothing new is given the old key's controller. */
export function rekeyBoard(from: string): void {
  const entry = entries.get(from);
  if (entry?.timer) clearTimeout(entry.timer);
  entries.delete(from);
}

/** How many controllers are held (for tests). */
export const heldBoards = (): number => entries.size;
