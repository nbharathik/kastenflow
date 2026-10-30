// Which rows of a table are picked: toggles, Shift ranges, a whole group, and
// Shift+arrows. Pure, so the rules are table-tested. Rows are named by path;
// `order` is always the rows as drawn now, top to bottom.

export interface Picked {
  paths: ReadonlySet<string>;
  /** Where a Shift range starts: the row last toggled or clicked. */
  anchor: string | null;
  /** Where a Shift+arrow run reached last, so a run goes on only from there. */
  head: string | null;
}

export const NOTHING: Picked = { paths: new Set(), anchor: null, head: null };

const pick = (paths: ReadonlySet<string>, row: string): Picked => ({ paths, anchor: row, head: row });

/** The selection with `path` added, or taken off when it was in. */
export function toggleRow(p: Picked, path: string): Picked {
  const next = new Set(p.paths);
  if (!next.delete(path)) next.add(path);
  return pick(next, path);
}

/** Shift+click: everything from the anchor to `path` takes the anchor's state,
 * as in a mail list. With no anchor in the table, only `path` toggles. */
export function rangeTo(p: Picked, order: readonly string[], path: string): Picked {
  const from = p.anchor === null ? -1 : order.indexOf(p.anchor);
  const to = order.indexOf(path);
  if (from < 0 || to < 0) return toggleRow(p, path);
  const on = p.paths.has(p.anchor!);
  const next = new Set(p.paths);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (on) next.add(order[i]!);
    else next.delete(order[i]!);
  }
  return pick(next, path);
}

export type GroupState = "none" | "some" | "all";

/** How many of a group's rows are picked. */
export function groupState(p: Picked, group: readonly string[]): GroupState {
  const n = group.filter((path) => p.paths.has(path)).length;
  return n === 0 ? "none" : n === group.length ? "all" : "some";
}

/** A group's checkbox: picks every row of the group, or, when all are already
 * picked, takes them all off. Other rows stay as they are. */
export function setGroup(p: Picked, group: readonly string[]): Picked {
  if (group.length === 0) return p;
  const next = new Set(p.paths);
  const all = groupState(p, group) === "all";
  for (const path of group) {
    if (all) next.delete(path);
    else next.add(path);
  }
  return { paths: next, anchor: group[0]!, head: group[0]! };
}

/** Shift+↑/↓ from the active row `head`: the run grows by the row moved to,
 * and shrinks when it comes back toward where it started. A run starts at the
 * active row; rows picked before stay picked. */
export function extend(p: Picked, order: readonly string[], head: string, delta: 1 | -1): Picked {
  const ih = order.indexOf(head);
  if (ih < 0) return p;
  const running = p.head === head && p.anchor !== null && order.includes(p.anchor);
  const anchor = running ? p.anchor! : head;
  const ia = order.indexOf(anchor);
  const nh = Math.min(Math.max(ih + delta, 0), order.length - 1);
  const next = new Set(p.paths);
  next.add(anchor);
  if (nh === ih) {
    next.add(head);
    return { paths: next, anchor, head };
  }
  const back = (ih > ia && nh < ih) || (ih < ia && nh > ih);
  if (back) {
    if (ih !== ia) next.delete(order[ih]!);
  } else {
    next.add(head);
    next.add(order[nh]!);
  }
  return { paths: next, anchor, head: order[nh]! };
}

/** The picked rows that are still shown, in table order. */
export function visibleOf(p: Picked, order: readonly string[]): string[] {
  return order.filter((path) => p.paths.has(path));
}

/** Every row picked. */
export function selectAll(order: readonly string[]): Picked {
  return { paths: new Set(order), anchor: order[0] ?? null, head: null };
}
