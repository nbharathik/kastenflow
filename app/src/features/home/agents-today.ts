// Words and times for Home's "Agents today": what an agent session did, said
// the way a person would, with no op, commit or session id in sight.

import type { DigestSession, NoteMeta } from "../../lib/vault/types";
import { count } from "../review/words";

/** Midnight at the start of today, in local time, in milliseconds. */
export function startOfToday(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** "3 changes in 2 notes", or "1 change" when no note is named. */
export function changeLine(session: Pick<DigestSession, "changes" | "notesTouched">): string {
  const changes = count(session.changes, "change");
  return session.notesTouched > 0 ? `${changes} in ${count(session.notesTouched, "note")}` : changes;
}

/** "1 waiting for you" or "3 waiting for you"; empty when nothing waits. */
export function waitingLine(session: Pick<DigestSession, "proposalsWaiting">): string {
  return session.proposalsWaiting > 0 ? `${session.proposalsWaiting} waiting for you` : "";
}

/** A note as the person knows it: its title when the vault lists it, else its file name without the ending. */
export function noteName(path: string, notes: readonly Pick<NoteMeta, "path" | "title">[]): string {
  const found = notes.find((n) => n.path === path);
  if (found?.title) return found.title;
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

/** The first few notes of a session by name, then how many more: "Plan, Welcome and 2 more". */
export function notesLine(session: Pick<DigestSession, "notes" | "notesTouched">, notes: readonly Pick<NoteMeta, "path" | "title">[], shown = 2): string {
  const names = session.notes.slice(0, shown).map((p) => noteName(p, notes));
  const more = session.notesTouched - names.length;
  if (names.length === 0) return "";
  const list = names.join(", ");
  return more > 0 ? `${list} and ${more} more` : list;
}
