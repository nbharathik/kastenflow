// The window's list of notes, kept in path order and changed without
// copying or re-sorting more than needed. Unchanged notes keep their object,
// so the sidebar and other lists redraw only what really changed.

import type { NoteMeta } from "../../lib/vault/types";

const SIMPLE = ["modified", "title", "kind", "icon", "cover", "parent", "project", "id", "created", "updated", "excerpt", "words", "locked"] as const;

/** Whether two pages store the same order for their sub-pages. */
const sameOrder = (a: NoteMeta, b: NoteMeta) => {
  const x = a.childrenOrder ?? [];
  const y = b.childrenOrder ?? [];
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

/** Whether two metas say the same thing (path assumed equal). */
export function sameMeta(a: NoteMeta, b: NoteMeta): boolean {
  if (a === b) return true;
  for (const key of SIMPLE) if (a[key] !== b[key]) return false;
  if (!sameOrder(a, b)) return false;
  if (a.tags.length !== b.tags.length || a.tags.some((t, i) => t !== b.tags[i])) return false;
  return JSON.stringify(a.props) === JSON.stringify(b.props);
}

/** What a save changes on every keystroke's worth of typing: the times, the
 * counts and the excerpt. A list drawn from these is stale for a moment at
 * worst, so they are kept apart (note-stats.ts) until the typing pauses. */
const LIVE = ["modified", "updated", "excerpt", "words"] as const;

/** Whether two metas say the same thing apart from `LIVE` (path assumed equal). */
export function sameShape(a: NoteMeta, b: NoteMeta): boolean {
  if (a === b) return true;
  for (const key of SIMPLE) if (!(LIVE as readonly string[]).includes(key) && a[key] !== b[key]) return false;
  if (!sameOrder(a, b)) return false;
  if (a.tags.length !== b.tags.length || a.tags.some((t, i) => t !== b.tags[i])) return false;
  return JSON.stringify(a.props) === JSON.stringify(b.props);
}

// The core lists notes by path in byte order; plain string order matches it.
const before = (a: string, b: string) => a < b;

function insertAt(notes: readonly NoteMeta[], path: string): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (before(notes[mid]!.path, path)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `notes` with `meta` added or replaced; the same array when nothing but
 * the times, counts and excerpt changed (see `settled` for those). */
export function upserted(notes: NoteMeta[], meta: NoteMeta): NoteMeta[] {
  return put(notes, meta, sameShape);
}

/** Like `upserted`, but the times, counts and excerpt count too. */
export function settled(notes: NoteMeta[], meta: NoteMeta): NoteMeta[] {
  return put(notes, meta, sameMeta);
}

function put(notes: NoteMeta[], meta: NoteMeta, same: (a: NoteMeta, b: NoteMeta) => boolean): NoteMeta[] {
  const at = insertAt(notes, meta.path);
  const found = notes[at]?.path === meta.path ? at : notes.findIndex((n) => n.path === meta.path);
  if (found >= 0) {
    if (same(notes[found]!, meta)) return notes;
    const next = notes.slice();
    next[found] = meta;
    return next;
  }
  const next = notes.slice();
  next.splice(at, 0, meta);
  return next;
}

/** The fresh list, reusing the old object for every note that did not change. */
export function merged(old: readonly NoteMeta[], fresh: NoteMeta[]): NoteMeta[] {
  const known = new Map(old.map((n) => [n.path, n]));
  let same = old.length === fresh.length;
  const out = fresh.map((meta, i) => {
    const before = known.get(meta.path);
    const keep = before && sameMeta(before, meta) ? before : meta;
    if (keep !== old[i]) same = false;
    return keep;
  });
  return same ? (old as NoteMeta[]) : out;
}

/** The list after the watcher reported `paths`: `found` are the notes among
 * them that exist; the other note paths are gone. */
export function patched(notes: NoteMeta[], paths: readonly string[], found: readonly NoteMeta[]): NoteMeta[] {
  const present = new Set(found.map((n) => n.path));
  const gone = new Set(paths.filter((p) => p.endsWith(".md") && !present.has(p)));
  let next = gone.size ? notes.filter((n) => !gone.has(n.path)) : notes;
  if (next.length === notes.length) next = notes;
  for (const meta of found) next = upserted(next, meta);
  return next;
}
