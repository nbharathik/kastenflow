// What every save changes about a note, and nothing else about it: the times,
// the word count and the excerpt. They are kept here, apart from the window's
// list of notes, so typing does not make everything drawn from that list draw
// again. The page's own details read them from here at once; the list takes
// them in when the typing pauses.

import { useMemo } from "react";
import { create } from "zustand";

import type { NoteMeta } from "../../lib/vault/types";

export type LiveStats = Pick<NoteMeta, "modified" | "updated" | "excerpt" | "words">;

/** How long typing must pause before the list takes the new counts in. */
export const SETTLE_MS = 2000;

/** The latest counts of notes the list has not taken in yet, by path. */
export const useNoteStats = create<{ of: Readonly<Record<string, LiveStats>> }>()(() => ({ of: {} }));

const waiting = new Map<string, NoteMeta>();
let timer: ReturnType<typeof setTimeout> | undefined;
let settle: ((metas: NoteMeta[]) => void) | null = null;

/** Keeps `meta`'s counts for now; `apply` is given every waiting meta once typing pauses. */
export function holdStats(meta: NoteMeta, apply: (metas: NoteMeta[]) => void): void {
  waiting.set(meta.path, meta);
  settle = apply;
  const { modified, updated, excerpt, words } = meta;
  useNoteStats.setState((s) => ({ of: { ...s.of, [meta.path]: { modified, updated, excerpt, words } } }));
  clearTimeout(timer);
  timer = setTimeout(settleStats, SETTLE_MS);
}

/** Hands the waiting counts to the list now. */
export function settleStats(): void {
  clearTimeout(timer);
  timer = undefined;
  if (waiting.size === 0) return;
  const metas = [...waiting.values()];
  waiting.clear();
  settle?.(metas);
  useNoteStats.setState({ of: {} });
}

/** Forgets the waiting counts of `path` (or of every note): the list now has newer ones. */
export function dropStats(path?: string): void {
  if (path === undefined) waiting.clear();
  else waiting.delete(path);
  if (waiting.size === 0) {
    clearTimeout(timer);
    timer = undefined;
  }
  useNoteStats.setState((s) => {
    if (path === undefined) return Object.keys(s.of).length ? { of: {} } : s;
    if (!(path in s.of)) return s;
    const { [path]: _gone, ...rest } = s.of;
    return { of: rest };
  });
}

/** `note` with the counts a save just brought, before the list has them. */
export function useLiveMeta(note: NoteMeta): NoteMeta {
  const live = useNoteStats((s) => s.of[note.path]);
  return useMemo(() => (live ? { ...note, ...live } : note), [note, live]);
}
