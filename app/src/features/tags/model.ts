// A tag database's data: the
// notes carrying a tag, its views as the app shows them, and what a view's
// filters, sorts and columns do. Pure functions, unit tested.

import { isoDay } from "../../lib/dates";
import type { NoteMeta, PropDef, TagSchema, TagView, TagViewKind, ViewFilter } from "../../lib/vault/types";
import { titleOf } from "../workspace/names";

export const VIEW_KINDS: readonly TagViewKind[] = ["table", "kanban", "list", "gallery", "calendar"];

/** What a new view of each kind is called. */
export const KIND_NAMES: Record<TagViewKind, string> = { table: "Table", kanban: "Board", list: "List", calendar: "Calendar", gallery: "Gallery" };

const lower = (s: string) => s.toLowerCase();
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Whether a note carries `tag`, matched without regard to case as the core does. */
export const carries = (note: NoteMeta, tag: string) => note.tags.some((t) => lower(t) === lower(tag));

/** The notes a tag's database lists: those carrying it, templates aside. */
export function notesWith(notes: readonly NoteMeta[], tag: string): NoteMeta[] {
  return notes.filter((n) => n.kind !== "template" && carries(n, tag));
}

export interface TagInfo {
  tag: string;
  count: number;
  schema: TagSchema | null;
}

/** Every tag, used on notes or given a schema, with its note count: most used first. */
export function vaultTags(counts: readonly { tag: string; count: number }[], schemas: readonly TagSchema[]): TagInfo[] {
  const out = new Map<string, TagInfo>();
  for (const { tag, count } of counts) {
    const known = out.get(lower(tag));
    if (known) known.count += count;
    else out.set(lower(tag), { tag, count, schema: null });
  }
  for (const schema of schemas) {
    const known = out.get(lower(schema.name));
    if (known) known.schema = schema;
    else out.set(lower(schema.name), { tag: schema.name, count: 0, schema });
  }
  return [...out.values()].sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** A key as YAML may write it: text, or a number such as 2026. */
const keyOf = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);
const FILTER_OPS: readonly string[] = ["is", "is_not", "contains", "empty", "not_empty", "before", "after"];

function readFilter(raw: unknown): ViewFilter | null {
  if (!isRecord(raw)) return null;
  const key = keyOf(raw.key);
  if (!key || !FILTER_OPS.includes(raw.op as string)) return null;
  return { ...raw, key, op: raw.op as ViewFilter["op"] };
}

function readSort(raw: unknown): { key: string; dir: "asc" | "desc" } | null {
  if (!isRecord(raw)) return null;
  const key = keyOf(raw.key);
  return key ? { ...raw, key, dir: raw.dir === "desc" ? "desc" : "asc" } : null;
}

/** A saved view as the app shows it, or null for one it cannot. Keys the
 * app does not know are kept, so saving the view keeps them too; settings
 * in a shape it cannot use (a filter that is not a list) are left out. */
export function readView(raw: unknown): TagView | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || !VIEW_KINDS.includes(raw.type as TagViewKind)) return null;
  const view: TagView = { ...raw, name, type: raw.type as TagViewKind };
  const known = <T>(list: (T | null)[]) => list.filter((item): item is T => item !== null);
  if ("filter" in raw) view.filter = known(listOf(raw.filter).map(readFilter));
  if ("sort" in raw) view.sort = known(listOf(raw.sort).map(readSort));
  if ("columns" in raw) view.columns = known(listOf(raw.columns).map(keyOf));
  for (const key of ["group_by", "date"] as const) {
    const value = keyOf(raw[key]);
    if (value) view[key] = value;
    else delete view[key];
  }
  if ("scope" in raw) {
    if (raw.scope === "project" || raw.scope === "vault") view.scope = raw.scope;
    else delete view.scope;
  }
  return view;
}

/** The views a tag shows: its own, else one table of everything. */
export function viewsOf(schema: TagSchema | null): TagView[] {
  const views = (schema?.views ?? []).map(readView).filter((v): v is TagView => v !== null);
  return views.length > 0 ? views : [{ name: "All", type: "table" }];
}

/** A name no view has yet: "Board", else "Board 2", "Board 3"... */
export function freshName(views: readonly TagView[], base: string): string {
  const taken = new Set(views.map((v) => lower(v.name)));
  if (!taken.has(lower(base))) return base;
  let n = 2;
  while (taken.has(lower(`${base} ${n}`))) n++;
  return `${base} ${n}`;
}

const firstOf = (schema: TagSchema | null, type: string) => schema?.properties.find((p) => p.type === type)?.key;

/** A new view of `kind`: a board grouped by the first select, a calendar
 * by the first date. */
export function newView(kind: TagViewKind, schema: TagSchema | null, views: readonly TagView[]): TagView {
  const view: TagView = { name: freshName(views, KIND_NAMES[kind]), type: kind };
  const select = firstOf(schema, "select");
  const date = firstOf(schema, "date");
  if (kind === "kanban" && select) view.group_by = select;
  if (kind === "calendar" && date) view.date = date;
  return view;
}

/** Keys every note has besides its properties. */
export const BUILT_IN: Record<string, string> = { title: "Title", created: "Created", updated: "Updated", modified: "Edited" };

/** Three more keys, for views that span more than one tag, such as a project's
 * saved tables (their `scope` key is set): what they are called. A tag's own
 * views do not treat them as built in, so a property of the same name is still
 * only a property there. */
export const ROW_LABELS: Record<string, string> = { project: "Project", type: "Type", tags: "Tags" };

/** What a key is called in a view's chips and headers. */
export const keyLabel = (view: TagView, key: string): string => BUILT_IN[key] ?? (view.scope !== undefined ? ROW_LABELS[key] : undefined) ?? key;

/** A note's value for `key`: its property, else a built-in field. */
export function valueOf(note: NoteMeta, key: string): unknown {
  if (Object.hasOwn(note.props, key)) return note.props[key];
  switch (key) {
    case "title":
      return titleOf(note);
    case "created":
      return note.created;
    case "updated":
      return note.updated;
    case "modified":
      return note.modified;
    case "project":
      return note.project;
    case "type":
      return note.kind;
    case "tags":
      return note.tags;
    default:
      return null;
  }
}

/** The built-in fields only a view that spans tags and projects offers (it has a `scope`): a tag's own views are of one tag. */
export const ROW_FIELDS = ["project", "type", "tags"] as const;

/** Whether a view spans tags and projects: a project's saved table, which has a `scope`. */
export const spans = (view: TagView): boolean => view.scope !== undefined;

/** How far a saved table reaches: only the notes of the project it is saved in (the default), or the whole vault. */
export type TableScope = "project" | "vault";

/** The notes a view with a `scope` covers: the pages and cards in `folder` (not the project's own page) for a project's table, every note for a vault-wide one; a view without a scope is a tag's and covers what it is given. */
export function scoped(notes: readonly NoteMeta[], view: TagView, folder: string | null): NoteMeta[] {
  const scope = view.scope;
  if (scope === undefined) return [...notes];
  const open = notes.filter((n) => n.kind !== "template");
  return scope === "vault" ? open : open.filter((n) => folder !== null && n.project === folder && n.kind !== "project");
}

/** The project folder a page lives in, from its path (`projects/trip/pages/plan.md` is `trip`); null for a page that is in no project. */
export const projectFolderOf = (path: string | null | undefined): string | null => /^projects\/([^/]+)\//.exec(path ?? "")?.[1] ?? null;

const isEmpty = (value: unknown) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
const textOf = (value: unknown): string => (Array.isArray(value) ? value.map(textOf).join(" ") : value === null || value === undefined ? "" : lower(String(value)));
/** The day a value names: a date's, or an edit time's (milliseconds) here. */
const dayOf = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? isoDay(new Date(value)) : typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
const truthy = (value: unknown) => value === true || value === "true";

function same(value: unknown, wanted: unknown, def: PropDef | undefined): boolean {
  if (def?.type === "checkbox") return truthy(value) === truthy(wanted);
  if (Array.isArray(value)) return value.some((v) => same(v, wanted, undefined));
  return !isEmpty(value) && textOf(value) === textOf(wanted);
}

/** Whether a note passes one filter. */
export function passes(note: NoteMeta, filter: ViewFilter, def: PropDef | undefined): boolean {
  const value = valueOf(note, filter.key);
  switch (filter.op) {
    case "empty":
      return isEmpty(value) || (def?.type === "checkbox" && !truthy(value));
    case "not_empty":
      return !(isEmpty(value) || (def?.type === "checkbox" && !truthy(value)));
    case "is":
      return same(value, filter.value, def);
    case "is_not":
      return !same(value, filter.value, def);
    case "contains":
      return textOf(value).includes(textOf(filter.value));
    case "before":
      return dayOf(value) !== "" && dayOf(value) < dayOf(filter.value);
    case "after":
      return dayOf(value) !== "" && dayOf(value) > dayOf(filter.value);
    default:
      return true;
  }
}

/** Orders two present values by the property's type: numbers by size, dates
 * by day, selects by their options' order, the rest as text. */
function compareValues(a: unknown, b: unknown, def: PropDef | undefined, key: string): number {
  const type = def?.type ?? (key === "modified" ? "number" : key === "created" || key === "updated" ? "date" : "text");
  switch (type) {
    case "number":
      return Number(a) - Number(b);
    case "checkbox":
      return Number(truthy(a)) - Number(truthy(b));
    case "select": {
      const at = (v: unknown) => {
        const i = def!.options.findIndex((o) => lower(o) === textOf(v));
        return i < 0 ? def!.options.length : i;
      };
      return at(a) - at(b) || collator.compare(textOf(a), textOf(b));
    }
    default:
      return collator.compare(Array.isArray(a) ? String(a[0] ?? "") : String(a), Array.isArray(b) ? String(b[0] ?? "") : String(b));
  }
}

/** The notes a view shows, filtered and sorted; empty values sort last
 * either way, and title breaks ties. */
/** The notes whose title or a property's value holds `query`, ignoring
 * case: the view's quick find, which is not saved with it. */
export function findInView(notes: readonly NoteMeta[], query: string): NoteMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...notes];
  const holds = (value: unknown): boolean => (Array.isArray(value) ? value.some(holds) : value !== null && value !== undefined && String(value).toLowerCase().includes(q));
  return notes.filter((n) => titleOf(n).toLowerCase().includes(q) || Object.values(n.props).some(holds));
}

export function applyView(notes: readonly NoteMeta[], view: TagView, schema: TagSchema | null): NoteMeta[] {
  const defs = new Map((schema?.properties ?? []).map((p) => [p.key, p]));
  const shown = notes.filter((note) => (view.filter ?? []).every((f) => passes(note, f, defs.get(f.key))));
  const sorts = view.sort ?? [];
  const titles = new Map(shown.map((n) => [n.path, titleOf(n)]));
  return shown.sort((a, b) => {
    for (const { key, dir } of sorts) {
      const va = valueOf(a, key);
      const vb = valueOf(b, key);
      if (isEmpty(va) || isEmpty(vb)) {
        if (isEmpty(va) !== isEmpty(vb)) return isEmpty(va) ? 1 : -1;
        continue;
      }
      const order = compareValues(va, vb, defs.get(key), key);
      if (order !== 0) return dir === "desc" ? -order : order;
    }
    return collator.compare(titles.get(a.path)!, titles.get(b.path)!);
  });
}

/** The select property a board groups by: the view's, else the tag's first. */
export function groupDef(view: TagView, schema: TagSchema | null): PropDef | null {
  const selects = (schema?.properties ?? []).filter((p) => p.type === "select");
  return selects.find((p) => p.key === view.group_by) ?? selects[0] ?? null;
}

export interface Column {
  /** The option the column stands for; null for notes without one. */
  value: string | null;
  label: string;
  notes: NoteMeta[];
}

/** A board's columns: one per option in order, then values the schema does
 * not list, with "No <key>" first when some notes have none. */
export function columnsOf(notes: readonly NoteMeta[], def: PropDef): Column[] {
  const columns: Column[] = def.options.map((o) => ({ value: o, label: o, notes: [] }));
  const none: Column = { value: null, label: `No ${def.key}`, notes: [] };
  for (const note of notes) {
    const raw = valueOf(note, def.key);
    const first = Array.isArray(raw) ? raw[0] : raw;
    const text = typeof first === "string" ? first.trim() : typeof first === "number" ? String(first) : "";
    if (!text) {
      none.notes.push(note);
      continue;
    }
    let column = columns.find((c) => lower(c.value!) === lower(text));
    if (!column) columns.push((column = { value: text, label: text, notes: [] }));
    column.notes.push(note);
  }
  return none.notes.length > 0 ? [none, ...columns] : columns;
}
