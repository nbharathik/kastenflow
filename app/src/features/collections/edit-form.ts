// The Edit dialog's form and the edit it makes: only what the person
// changed is sent, so every other line of the collection's file stays.

import { COLLECTION_LIMITS, WHEN_FIELDS, type Collection, type CollectionEdits, type CollectionSort, type CollectionWhen, type WhenField, type WhenToken } from "../../lib/vault/collection-types";
import type { TagViewKind, ViewFilter } from "../../lib/vault/types";

export const FORM_KINDS: readonly { id: TagViewKind; label: string }[] = [
  { id: "table", label: "Table" },
  { id: "list", label: "List" },
  { id: "gallery", label: "Gallery" },
];

export const FILTER_OPS: readonly { id: ViewFilter["op"]; label: string; needsValue: boolean }[] = [
  { id: "is", label: "is", needsValue: true },
  { id: "is_not", label: "is not", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "empty", label: "is empty", needsValue: false },
  { id: "not_empty", label: "is not empty", needsValue: false },
  { id: "before", label: "is before (day)", needsValue: true },
  { id: "after", label: "is after (day)", needsValue: true },
];

export interface FilterRow {
  key: string;
  op: ViewFilter["op"];
  value: string;
}

export interface SortRow {
  key: string;
  dir: "asc" | "desc";
}

export interface Form {
  icon: string;
  query: string;
  /** The day field a span is about, or "" for no span. */
  whenField: WhenField | "";
  whenToken: WhenToken;
  kind: TagViewKind;
  /** Text, so a half-typed number is kept; empty for the default. */
  limit: string;
  filters: FilterRow[];
  sorts: SortRow[];
}

export function formOf(collection: Collection): Form {
  const first = (Object.entries(collection.when ?? {}) as [WhenField, WhenToken][])[0];
  return {
    icon: collection.icon ?? "",
    query: collection.query,
    whenField: first?.[0] ?? "",
    whenToken: first?.[1] ?? "last-30-days",
    kind: collection.display?.type ?? "table",
    limit: collection.display?.limit === undefined ? "" : String(collection.display.limit),
    filters: collection.filter.map((f) => ({ key: f.key, op: f.op, value: f.value === undefined || f.value === null ? "" : String(f.value) })),
    sorts: collection.sort.map((s) => ({ key: s.key, dir: s.dir ?? "asc" })),
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The filters the rows make: a row with no key is no filter, and an op that needs no value carries none. */
export function filtersOf(rows: readonly FilterRow[]): ViewFilter[] {
  return rows
    .filter((row) => row.key.trim() !== "")
    .map((row) => {
      const needs = FILTER_OPS.find((o) => o.id === row.op)?.needsValue ?? true;
      return needs ? { key: row.key.trim(), op: row.op, value: row.value } : { key: row.key.trim(), op: row.op };
    });
}

export const sortsOf = (rows: readonly SortRow[]): CollectionSort[] => rows.filter((row) => row.key.trim() !== "").map((row) => ({ key: row.key.trim(), dir: row.dir }));

/** What to send to change `collection` into `form`: the keys that differ, `null` for one the form emptied. */
export function editsOf(collection: Collection, form: Form): CollectionEdits {
  const edits: CollectionEdits = {};
  const icon = form.icon.trim();
  if (icon !== (collection.icon ?? "")) edits.icon = icon === "" ? null : icon;
  if (form.query !== collection.query) edits.query = form.query.trim() === "" ? null : form.query.trim();
  const when: CollectionWhen | null = form.whenField === "" ? null : { [form.whenField]: form.whenToken };
  if (!sameJson(when, collection.when)) edits.when = when;
  const filter = filtersOf(form.filters);
  if (!sameJson(filter, collection.filter)) edits.filter = filter.length === 0 ? null : filter;
  const sort = sortsOf(form.sorts);
  if (!sameJson(sort, collection.sort.map((s) => ({ key: s.key, dir: s.dir ?? "asc" })))) edits.sort = sort.length === 0 ? null : sort;
  const limit = form.limit.trim() === "" ? undefined : Math.min(COLLECTION_LIMITS.shown, Math.max(1, Math.trunc(Number(form.limit)) || 1));
  const was = collection.display ?? {};
  const display: Record<string, unknown> = { ...was, type: form.kind };
  if (limit === undefined) delete display.limit;
  else display.limit = limit;
  // A collection shown the usual way, with nothing said, keeps saying nothing.
  const untouched = (was.type ?? "table") === form.kind && was.limit === limit;
  if (!untouched) edits.display = display;
  return edits;
}

export const hasEdits = (edits: CollectionEdits): boolean => Object.keys(edits).length > 0;

/** The fields a `when` can be about, for the form's menu. */
export const WHEN_CHOICES: readonly { id: WhenField | ""; label: string }[] = [{ id: "", label: "Any time" }, ...WHEN_FIELDS.map((id) => ({ id, label: id === "updated" ? "Changed" : id === "created" ? "Made" : "Made or changed" }))];
