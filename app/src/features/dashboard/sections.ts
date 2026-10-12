// A dashboard (Home, and each project's home) is a list of sections the
// person turns on and orders. These helpers keep that list tidy: known ids
// only, each once, in the person's order.

import type { IconName } from "../../ui/Icon";

export interface SectionDef<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconName;
  /** What the section shows, for the Customize list. */
  hint: string;
  /** Takes a whole row rather than half of one. */
  wide?: boolean;
  /** Where Home puts it: the main column or the slim one beside it. */
  zone?: "main" | "side";
}

/** The known ids in `saved`, each once and in its order; `fallback` when
 * `saved` is not a list. */
export function chosen<Id extends string>(saved: unknown, defs: readonly SectionDef<Id>[], fallback: readonly Id[]): Id[] {
  if (!Array.isArray(saved)) return [...fallback];
  const known = new Set<string>(defs.map((d) => d.id));
  const out: Id[] = [];
  for (const value of saved) {
    const id = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (known.has(id) && !out.includes(id as Id)) out.push(id as Id);
  }
  return out;
}

/** `list` with `id` moved `step` places up (negative) or down, kept inside it. */
export function shifted<Id extends string>(list: readonly Id[], id: Id, step: number): Id[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const to = Math.max(0, Math.min(list.length - 1, from + step));
  const out = [...list];
  out.splice(from, 1);
  out.splice(to, 0, id);
  return out;
}

/** `list` with `id` taken from where it is and put where `target` is, as dropping one row on another does. */
export function moved<Id extends string>(list: readonly Id[], id: Id, target: Id): Id[] {
  const from = list.indexOf(id);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...list];
  const out = [...list];
  out.splice(from, 1);
  out.splice(to, 0, id);
  return out;
}

/** `list` with `id` turned off, or on: then it goes after the shown
 * sections that come before it in `defs`, so it lands near its usual place. */
export function toggled<Id extends string>(list: readonly Id[], id: Id, defs: readonly SectionDef<Id>[]): Id[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  const order = defs.map((d) => d.id);
  const before = new Set(order.slice(0, order.indexOf(id)));
  let at = 0;
  list.forEach((x, i) => {
    if (before.has(x)) at = i + 1;
  });
  return [...list.slice(0, at), id, ...list.slice(at)];
}

/** Whether two lists hold the same ids in the same order. */
export const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Which half-width sections would sit alone on their row, beside a hole:
 * the last of an odd run before a wide section or the end. Sections with
 * nothing to show take no place. The grid gives those a whole row. */
export function alone(cells: readonly { wide: boolean; shown: boolean }[]): boolean[] {
  const out = cells.map(() => false);
  let open: number | null = null;
  cells.forEach((cell, i) => {
    if (!cell.shown) return;
    if (cell.wide) {
      if (open !== null) out[open] = true;
      open = null;
    } else open = open === null ? i : null;
  });
  if (open !== null) out[open] = true;
  return out;
}
