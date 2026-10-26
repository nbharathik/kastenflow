// Grouping a table's rows: which property the view groups by, which group a
// note falls in, and the groups in order (a property's options as listed, a
// date's months by time, the rest by name; "No value" last). With sub-items a
// sub-item stays under its parent, in the parent's group. Pure, unit tested.

import type { NoteMeta, PropDef, TagSchema, TagView } from "../../../../lib/vault/types";
import { spans, valueOf } from "../../model";

export type GroupKind = "select" | "multi_select" | "checkbox" | "date" | "relation" | "project";

export interface GroupSpec {
  key: string;
  kind: GroupKind;
  /** The property's options, which order the groups. */
  options: readonly string[];
}

/** What the group of notes without a value is called. */
export const NO_VALUE = "No value";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const lower = (s: string) => s.toLowerCase();

const KINDS: Record<string, GroupKind> = { select: "select", multi_select: "multi_select", checkbox: "checkbox", date: "date", relation: "relation" };

/** The property a table groups by, or null when the view does not group or
 * names something that cannot be grouped (a removed property, a number). */
export function groupSpec(view: TagView, schema: TagSchema | null): GroupSpec | null {
  const key = typeof view.group_by === "string" ? view.group_by : "";
  if (view.type !== "table" || !key) return null;
  const def: PropDef | undefined = schema?.properties.find((p) => p.key === key);
  if (def) {
    const kind = Object.hasOwn(KINDS, def.type) ? KINDS[def.type] : undefined;
    return kind ? { key, kind, options: def.options } : null;
  }
  if (key === "created" || key === "updated") return { key, kind: "date", options: [] };
  if (key === "project" && spans(view)) return { key, kind: "project", options: [] };
  return null;
}

/** The groupable properties a table offers: the tag's, then the built-in dates. */
export function groupChoices(view: TagView, schema: TagSchema | null): { key: string; label: string }[] {
  const props = (schema?.properties ?? []).filter((p) => Object.hasOwn(KINDS, p.type)).map((p) => ({ key: p.key, label: p.key }));
  const own = new Set((schema?.properties ?? []).map((p) => p.key));
  const built = [{ key: "created", label: "Created" }, { key: "updated", label: "Updated" }, ...(spans(view) ? [{ key: "project", label: "Project" }] : [])];
  return [...props, ...built.filter((b) => !own.has(b.key))];
}

/** The view grouped by `key`, or ungrouped for null; other keys stay. */
export function withGroup(view: TagView, key: string | null): TagView {
  const next = { ...view };
  if (key) next.group_by = key;
  else delete next.group_by;
  return next;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** The month a date value falls in, as "2026-03", or "". */
function monthOf(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString().slice(0, 7);
  return typeof value === "string" && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

/** The id of the group a note is in; null for "No value". */
export function groupId(note: NoteMeta, spec: GroupSpec): string | null {
  const raw = valueOf(note, spec.key);
  if (spec.kind === "checkbox") return raw === true || raw === "true" ? "true" : "false";
  if (spec.kind === "date") return monthOf(raw) || null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const text = textOf(first);
  if (!text) return null;
  if (spec.kind === "select" || spec.kind === "multi_select") return spec.options.find((o) => lower(o) === lower(text)) ?? text;
  return text;
}

/** A relation's id as a title, when the table can look it up. */
export type Resolve = (id: string) => string;

/** What a group's header says. */
export function groupLabel(spec: GroupSpec, id: string | null, resolve?: Resolve): string {
  if (id === null) return NO_VALUE;
  if (spec.kind === "checkbox") return id === "true" ? "Checked" : "Not checked";
  if (spec.kind === "date") {
    const [year, month] = id.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return spec.kind === "relation" && resolve ? resolve(id) : id;
}

/** The ids of the groups present, in order: options as listed then unlisted
 * values by name, checked before not checked, months by time, the rest by
 * label; no value last. */
export function orderGroups(spec: GroupSpec, present: Iterable<string | null>, resolve?: Resolve): (string | null)[] {
  const ids = new Set(present);
  const named = [...ids].filter((id): id is string => id !== null);
  let ordered: string[];
  if (spec.kind === "select" || spec.kind === "multi_select") {
    const at = (id: string) => spec.options.indexOf(id);
    ordered = named.sort((a, b) => (at(a) < 0 ? spec.options.length : at(a)) - (at(b) < 0 ? spec.options.length : at(b)) || collator.compare(a, b));
  } else if (spec.kind === "checkbox") ordered = named.sort((a, b) => (a === b ? 0 : a === "true" ? -1 : 1));
  else if (spec.kind === "date") ordered = named.sort();
  else ordered = named.sort((a, b) => collator.compare(groupLabel(spec, a, resolve), groupLabel(spec, b, resolve)));
  return ids.has(null) ? [...ordered, null] : ordered;
}

export interface Group<T> {
  id: string | null;
  label: string;
  items: T[];
}

/** `items` split into their groups, in order, each keeping its items' order;
 * `ids[i]` is item i's group. */
export function partition<T>(items: readonly T[], ids: readonly (string | null)[], spec: GroupSpec, resolve?: Resolve): Group<T>[] {
  const by = new Map<string | null, T[]>();
  items.forEach((item, i) => {
    const id = ids[i] ?? null;
    const list = by.get(id);
    if (list) list.push(item);
    else by.set(id, [item]);
  });
  return orderGroups(spec, by.keys(), resolve).map((id) => ({ id, label: groupLabel(spec, id, resolve), items: by.get(id)! }));
}

/** Each row's group when sub-items are on: a row under another takes the
 * group of the top-level row it hangs from. `rows` are in tree order. */
export function inheritedIds(rows: readonly { note: NoteMeta; depth: number }[], spec: GroupSpec): (string | null)[] {
  let current: string | null = null;
  return rows.map((row) => {
    if (row.depth === 0) current = groupId(row.note, spec);
    return current;
  });
}

/** The notes of each group, whole (folded sub-items too), for counts and
 * calculations. With sub-items a note counts in its top-level ancestor's
 * group; `pool` is every note of the database, to find the ancestors. */
export function membersOf(shown: readonly NoteMeta[], pool: readonly NoteMeta[], spec: GroupSpec, tree: boolean): Map<string | null, NoteMeta[]> {
  const out = new Map<string | null, NoteMeta[]>();
  const byId = new Map<string, NoteMeta>();
  if (tree) {
    for (const n of pool) if (n.id) byId.set(n.id, n);
    for (const n of shown) if (n.id && !byId.has(n.id)) byId.set(n.id, n);
  }
  const memo = new Map<string, string | null>();
  const idOf = (note: NoteMeta): string | null => {
    if (!tree) return groupId(note, spec);
    const known = memo.get(note.path);
    if (known !== undefined) return known;
    // Walk up to the top (a ring of parents stops where it comes round).
    const seen = new Set<string>();
    let top = note;
    while (!seen.has(top.path)) {
      seen.add(top.path);
      const parent = top.parent ? byId.get(top.parent) : undefined;
      if (!parent || parent.path === top.path || seen.has(parent.path)) break;
      top = parent;
    }
    const id = top === note ? groupId(note, spec) : (memo.get(top.path) ?? groupId(top, spec));
    memo.set(note.path, id);
    return id;
  };
  for (const note of shown) {
    const id = idOf(note);
    const list = out.get(id);
    if (list) list.push(note);
    else out.set(id, [note]);
  }
  return out;
}
