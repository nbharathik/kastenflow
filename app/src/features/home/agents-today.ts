// Words and times for Home's "Agents today": what an agent session did, said
// the way a person would, with no op, commit or session id in sight.

import type { Digest, DigestSession, NoteMeta } from "../../lib/vault/types";
import { count } from "../review/words";

/** Sessions shown before "and N more". */
export const SESSION_LIMIT = 3;

/** Sessions with something waiting first (most waiting first), the rest as they came. */
export function waitingFirst<T extends Pick<DigestSession, "proposalsWaiting">>(sessions: readonly T[]): T[] {
  // Array.sort is stable, so sessions that wait equally keep their order (newest first).
  return [...sessions].sort((a, b) => (b.proposalsWaiting > 0 ? b.proposalsWaiting : 0) - (a.proposalsWaiting > 0 ? a.proposalsWaiting : 0));
}

/** "5 agents · 23 changes · 2 waiting for you"; the last part only when something waits. */
export function summaryLine(digest: Pick<Digest, "sessions" | "changes" | "waiting">): string {
  const parts = [count(digest.sessions.length, "agent"), count(digest.changes, "change")];
  if (digest.waiting > 0) parts.push(`${digest.waiting} waiting for you`);
  return parts.join(" · ");
}

/** The strip under Home's top line: "Agents changed 23 things today". */
export const stripLine = (digest: Pick<Digest, "changes">): string => `Agents changed ${count(digest.changes, "thing")} today`;

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
