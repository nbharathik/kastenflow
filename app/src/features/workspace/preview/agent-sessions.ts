// The browser preview's stand-in for agent sessions: versions an agent wrote
// carry its session and client, so the History view lists the session and
// undoing it reverts them, newest first, as the core does with git. The chat's
// and the brainstorm's preview stand-ins write as agents. Also the file a saved
// chat becomes (the core's `save_chat`).

import { isoDay } from "../../../lib/dates";
import type { Digest, DigestSession, SessionInfo } from "../../../lib/vault/types";
import { yamlScalar } from "../../pages/page/page-meta";
import type { Version } from "./stored";
import { newId, newestFirst, slugify, stamps } from "./vault-text";

/** Who writes: an agent session and the client it belongs to. */
export interface Agent {
  session: string;
  client: string;
}

type Versions = Record<string, Version[]>;

/** Ids of the versions a later version undid. */
export function undoneIds(versions: Versions): Set<string> {
  return new Set(
    Object.values(versions)
      .flat()
      .flatMap((v) => (v.undoes ? [v.undoes] : [])),
  );
}

/** Agent sessions from their versions, the latest first. */
export function sessionsIn(versions: Versions, limit = 50): SessionInfo[] {
  const undone = undoneIds(versions);
  const by = new Map<string, SessionInfo>();
  for (const version of Object.values(versions).flat()) {
    if (!version.session) continue;
    const s = by.get(version.session) ?? { id: version.session, client: version.client ?? "agent", started: version.time, last: version.time, commits: 0, undone: true };
    s.commits += 1;
    s.started = Math.min(s.started, version.time);
    s.last = Math.max(s.last, version.time);
    s.undone &&= undone.has(version.id);
    by.set(version.session, s);
  }
  return [...by.values()].sort((a, b) => b.last - a.last).slice(0, limit);
}

/** What agents did since `since`, session by session, from their versions (a person's versions carry no session). A proposal is not a version here. */
export function digestIn(versions: Versions, since: number): Digest {
  const undone = undoneIds(versions);
  const by = new Map<string, { s: DigestSession; paths: Set<string>; allUndone: boolean }>();
  for (const [path, list] of Object.entries(versions)) {
    for (const version of list) {
      if (!version.session) continue;
      const entry = by.get(version.session) ?? { s: { id: version.session, client: version.client ?? "agent", started: version.time, last: version.time, changes: 0, proposed: 0, notesTouched: 0, notes: [], mode: null, proposalsWaiting: 0, canUndo: false, undone: false }, paths: new Set<string>(), allUndone: true };
      entry.s.started = Math.min(entry.s.started, version.time);
      entry.s.last = Math.max(entry.s.last, version.time);
      entry.allUndone &&= undone.has(version.id);
      if (version.time >= since) {
        entry.s.changes += 1;
        entry.paths.add(path);
      }
      by.set(version.session, entry);
    }
  }
  const sessions = [...by.values()]
    .filter((e) => e.s.changes > 0)
    .map(({ s, paths, allUndone }) => ({ ...s, notesTouched: paths.size, notes: [...paths].sort().slice(0, 50), undone: allUndone, canUndo: !allUndone }))
    .sort((a, b) => b.last - a.last);
  return { since, sessions, changes: sessions.reduce((n, s) => n + s.changes, 0), waiting: 0 };
}

export interface SessionEdit {
  path: string;
  version: Version;
  /** The note's version before this one; null when this one made the note. */
  before: Version | null;
}

/** A session's versions not undone yet, newest first: the order an undo takes. */
export function sessionEdits(versions: Versions, session: string): SessionEdit[] {
  const undone = undoneIds(versions);
  const out: SessionEdit[] = [];
  for (const [path, list] of Object.entries(versions)) {
    list.forEach((version, i) => {
      if (version.session === session && !undone.has(version.id)) out.push({ path, version, before: i > 0 ? list[i - 1]! : null });
    });
  }
  return out.sort((a, b) => newestFirst(a.version, b.version));
}

/** A saved chat: `chats/<day>-<slug>.md` with `type: chat`, the transcript as its body. */
export function chatFile(title: string, markdown: string, now: number): { stem: string; text: string } {
  const name = title.trim().replace(/[\r\n]+/g, " ") || "Chat";
  const at = stamps(now).rfc3339;
  const head = ["---", `id: ${newId(now)}`, `title: ${yamlScalar(name)}`, "type: chat", `created: ${at}`, `updated: ${at}`, "---", ""].join("\n");
  return { stem: `${isoDay(new Date(now))}-${slugify(name)}`, text: head + (markdown.endsWith("\n") ? markdown : `${markdown}\n`) };
}
