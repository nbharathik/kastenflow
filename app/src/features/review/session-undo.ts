// What undoing a session needs to know, and taking an undo back: how many of its
// changes are left to undo (a chat asks first only when there are many), and
// "Undo the undo", which undoes the commits an undo made.

import type { Undone, VaultClient } from "../../lib/vault/types";
import { changesLeft } from "./group";

/** How far back the history is read for a session's commits. */
const LOOK_BACK = 300;
const SESSIONS = 50;

/** Changes a chat may undo at once. More than this are asked about first, with their count. */
export const ASK_OVER = 5;

/** How many changes undoing the session would revert. */
export async function changesInSession(client: VaultClient, session: string): Promise<number> {
  const [sessions, commits] = await Promise.all([client.sessions(SESSIONS), client.history(null, LOOK_BACK)]);
  const found = sessions.find((s) => s.id === session);
  return found ? changesLeft(found, commits) : 0;
}

/** Takes an undo back: the commits that undid `reverted` are themselves undone,
 * newest first, so the notes are as they were before the undo. Stops, and says
 * where, at a change made since that it would overwrite. */
export async function undoTheUndo(client: VaultClient, reverted: readonly string[]): Promise<Undone> {
  const wanted = new Set(reverted);
  const log = await client.history(null, LOOK_BACK);
  const redone: string[] = [];
  for (const commit of log.filter((c) => c.undoes !== null && c.undoes !== undefined && wanted.has(c.undoes))) {
    const outcome = await client.undoCommit(commit.id);
    redone.push(...outcome.reverted);
    if (outcome.conflict) return { reverted: redone, conflict: outcome.conflict };
  }
  return { reverted: redone, conflict: null };
}
