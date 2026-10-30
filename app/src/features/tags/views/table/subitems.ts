// Sub-items in the table: the rows a view shows, laid out as a tree (a note
// whose `parent` is another row sits under it) and flattened to the rows
// that are visible, which is what the window draws. Pure, unit tested.

import type { NoteMeta } from "../../../../lib/vault/types";

/** What a row's fold toggle is: no toggle at all (sub-items off), a row with
 * no children, or a row with children that is shut or open. */
export type Fold = "none" | "leaf" | "closed" | "open";

export interface FlatRow {
  note: NoteMeta;
  /** How many rows it is inside: 0 for a top-level row. */
  depth: number;
  /** Shown only because a row below it matches: greyed, and not counted. */
  dim: boolean;
  fold: Fold;
}

export interface Flat {
  rows: FlatRow[];
  /** The rows that match the view, wherever they sit and whether or not they are in view. */
  matching: number;
}

/** What remembers that a row is open: its id, else its path. */
export const foldKey = (note: NoteMeta): string => note.id ?? note.path;

/** Lays `shown` (the rows the view's filters and find keep, in order) out as a
 * tree through `pool` (all the tag's notes, in the same order): a row whose
 * `parent` is another row sits under it, to any depth; a row whose parent is
 * not a row (an orphan) is top level; a ring of parents is cut at its first
 * row. A matching row below a row that does not match shows with its
 * ancestors, greyed and open. Only rows under an open row are listed. */
export function flatten(shown: readonly NoteMeta[], pool: readonly NoteMeta[], expanded: ReadonlySet<string>): Flat {
  const rank = new Map<string, number>();
  pool.forEach((n, i) => rank.set(n.path, i));
  shown.forEach((n, i) => {
    if (!rank.has(n.path)) rank.set(n.path, pool.length + i);
  });
  const byId = new Map<string, NoteMeta>();
  for (const n of pool) if (n.id) byId.set(n.id, n);
  for (const n of shown) if (n.id && !byId.has(n.id)) byId.set(n.id, n);
  const parentOf = (n: NoteMeta): NoteMeta | undefined => {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    return parent && parent.path !== n.path ? parent : undefined;
  };

  // The rows to list: those that match (true is greyed: false) and the rows above them.
  const dim = new Map<string, boolean>();
  const notes = new Map<string, NoteMeta>();
  for (const n of shown) {
    dim.set(n.path, false);
    notes.set(n.path, n);
  }
  for (const n of shown) {
    for (let up = parentOf(n); up && !dim.has(up.path); up = parentOf(up)) {
      dim.set(up.path, true);
      notes.set(up.path, up);
    }
  }

  const under = new Map<string, NoteMeta[]>();
  const tops: NoteMeta[] = [];
  const byRank = (a: NoteMeta, b: NoteMeta) => rank.get(a.path)! - rank.get(b.path)!;
  for (const n of notes.values()) {
    const parent = parentOf(n);
    if (parent && notes.has(parent.path)) {
      const list = under.get(parent.path);
      if (list) list.push(n);
      else under.set(parent.path, [n]);
    } else tops.push(n);
  }
  tops.sort(byRank);
  for (const list of under.values()) list.sort(byRank);

  // Rows in a ring of parents have no top: the first of them in order is the top.
  const reached = new Set<string>();
  const reach = (root: NoteMeta) => {
    const stack = [root];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (reached.has(n.path)) continue;
      reached.add(n.path);
      for (const kid of under.get(n.path) ?? []) stack.push(kid);
    }
  };
  tops.forEach(reach);
  if (reached.size < notes.size) {
    for (const n of [...notes.values()].sort(byRank)) {
      if (reached.has(n.path)) continue;
      tops.push(n);
      reach(n);
    }
  }

  const rows: FlatRow[] = [];
  const seen = new Set<string>();
  const walk = (root: NoteMeta) => {
    const stack: [NoteMeta, number][] = [[root, 0]];
    while (stack.length > 0) {
      const [n, depth] = stack.pop()!;
      if (seen.has(n.path)) continue;
      seen.add(n.path);
      const kids = (under.get(n.path) ?? []).filter((k) => !seen.has(k.path));
      const greyed = dim.get(n.path)!;
      const open = kids.length > 0 && (greyed || expanded.has(foldKey(n)));
      rows.push({ note: n, depth, dim: greyed, fold: kids.length === 0 ? "leaf" : open ? "open" : "closed" });
      if (open) for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i]!, depth + 1]);
    }
  };
  for (const root of tops) walk(root);
  return { rows, matching: shown.length };
}

/** The keys of the rows that have a child among `rows`: what "Expand all" opens. */
export function parentsOf(rows: readonly NoteMeta[]): string[] {
  const byId = new Map<string, NoteMeta>();
  for (const n of rows) if (n.id) byId.set(n.id, n);
  const keys = new Set<string>();
  for (const n of rows) {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    if (parent && parent.path !== n.path) keys.add(foldKey(parent));
  }
  return [...keys];
}
