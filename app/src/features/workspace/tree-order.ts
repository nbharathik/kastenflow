// The order of a page's sub-pages: the ids its `childrenOrder` names come
// first, in that order, and the rest follow alphabetically (kasten-core's
// `arranged` does the same for every other reader).

import type { NoteMeta } from "../../lib/vault/types";

/** `alphabetical` (already sorted by title) arranged by `stored`. An id that
 * is none of them counts for nothing and an id twice counts once. The very
 * same array when nothing moves, so rows can skip redrawing. */
export function arranged(stored: readonly string[] | undefined, alphabetical: NoteMeta[]): NoteMeta[] {
  if (!stored || stored.length === 0 || alphabetical.length < 2) return alphabetical;
  const rest = alphabetical.slice();
  const out: NoteMeta[] = [];
  for (const id of stored) {
    const at = rest.findIndex((n) => n.id === id);
    if (at >= 0) out.push(rest.splice(at, 1)[0]!);
  }
  out.push(...rest);
  return out.every((n, i) => n === alphabetical[i]) ? alphabetical : out;
}

/** The ids to store when `moved` goes before (or with `after`, behind) `target`
 * among `siblings`, in the order they show. Every sub-page that has an id is
 * named, so the order is whole. Null when it would stay as it is, or either
 * is not among them. */
export function movedIds(siblings: readonly NoteMeta[], moved: string, target: string, after: boolean): string[] | null {
  const ids = siblings.map((n) => n.id).filter((id): id is string => id !== null);
  if (moved === target || !ids.includes(moved) || !ids.includes(target)) return null;
  const rest = ids.filter((id) => id !== moved);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? null : next;
}

/** The ids to store when `moved` goes one place up (-1) or down (1), or null
 * at the end of the list. */
export function steppedIds(siblings: readonly NoteMeta[], moved: string, step: -1 | 1): string[] | null {
  const ids = siblings.map((n) => n.id).filter((id): id is string => id !== null);
  const at = ids.indexOf(moved);
  const to = at + step;
  if (at < 0 || to < 0 || to >= ids.length) return null;
  const next = ids.slice();
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}
