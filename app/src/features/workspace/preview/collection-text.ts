// The preview's saved collections, as kasten-core's collections module does
// them: a file's keys read into a collection, an edit that changes only the
// keys it names (so unknown keys and comments stay), and the checks a value
// must pass. Inside the app the core does all of this.

import { readFlow, writeFlow, type Flow } from "../../../lib/flow-yaml";
import { COLLECTION_LIMITS, WHEN_FIELDS, WHEN_TOKENS, type Collection, type CollectionEdits } from "../../../lib/vault/collection-types";
import { setValue } from "./tag-yaml";
import { contentHash } from "./vault-text";

export const FORMAT = 1;
const FILTER_OPS = ["is", "is_not", "contains", "empty", "not_empty", "before", "after"];
const DISPLAY_TYPES = ["table", "kanban", "list", "calendar", "gallery"];
const KEYS = ["icon", "query", "when", "filter", "sort", "display"] as const;

/** Whether `path` names a collection's file: `views/<name>.yaml`, one level down. */
export const isCollectionPath = (path: string) => /^views\/[^/\\:\0.][^/\\:\0]*\.yaml$/.test(path);
export const slugOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.yaml$/, "");

const isMap = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Whether `text` has no control characters (a new line included). */
const plain = (text: string) => [...text].every((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f);

/** The sentence that says why `value` is not allowed for `key`, or null. */
export function checkValue(key: string, value: unknown): string | null {
  switch (key) {
    case "icon":
      return typeof value === "string" && value.trim() !== "" && value.trim().length <= 40 && plain(value) ? null : "An icon is a short name of at most 40 characters";
    case "query":
      if (typeof value !== "string") return "A query is text, written as in the search box";
      if (value.length > COLLECTION_LIMITS.query) return `A query is at most ${COLLECTION_LIMITS.query} characters; this one has ${value.length}`;
      return plain(value) ? null : "A query is one line";
    case "when": {
      if (!isMap(value) || Object.keys(value).length === 0) return "“when” names a day field and a span, such as updated: last-30-days";
      for (const [field, token] of Object.entries(value)) {
        if (!(WHEN_FIELDS as readonly string[]).includes(field)) return `“${field}” is not something to look for in time: use ${WHEN_FIELDS.join(", ")}`;
        if (typeof token !== "string" || !(WHEN_TOKENS as readonly string[]).includes(token)) return `“${String(token)}” is not a span of days: use ${WHEN_TOKENS.join(", ")}`;
      }
      return null;
    }
    case "filter": {
      if (!Array.isArray(value)) return "“filter” is a list";
      if (value.length > 50) return "A collection has at most 50 filters";
      for (const entry of value) {
        if (!isMap(entry)) return "Each filter is a key, an op and a value";
        const k = typeof entry.key === "string" ? entry.key.trim() : "";
        if (k === "" || k.length > 100) return "Each filter needs a key, a property’s name";
        if (typeof entry.op !== "string" || !FILTER_OPS.includes(entry.op)) return `The filter on “${k}” has no test called “${String(entry.op)}”: use ${FILTER_OPS.join(", ")}`;
        if (entry.op === "empty" || entry.op === "not_empty") continue;
        const wanted = entry.value;
        const fine = (typeof wanted === "string" && wanted.length <= 500 && plain(wanted)) || typeof wanted === "number" || typeof wanted === "boolean";
        if (!fine) return `The filter on “${k}” needs a value of up to 500 characters`;
        if ((entry.op === "before" || entry.op === "after") && !(typeof wanted === "string" && /^\d{4}-\d{2}-\d{2}/.test(wanted))) return `“${entry.op}” on “${k}” needs a day, such as 2026-10-01`;
      }
      return null;
    }
    case "sort": {
      if (!Array.isArray(value)) return "“sort” is a list";
      if (value.length > 10) return "A collection sorts by at most 10 keys";
      for (const entry of value) {
        const k = isMap(entry) && typeof entry.key === "string" ? entry.key.trim() : "";
        if (k === "") return "Each sort needs a key, a property’s name";
        if (isMap(entry) && entry.dir !== undefined && entry.dir !== "asc" && entry.dir !== "desc") return `Sorting by “${k}” goes asc or desc`;
      }
      return null;
    }
    case "display": {
      if (!isMap(value)) return "“display” is a type, columns and a limit";
      if (value.type !== undefined && !(typeof value.type === "string" && DISPLAY_TYPES.includes(value.type))) return `A collection is shown as one of ${DISPLAY_TYPES.join(", ")}`;
      if (value.columns !== undefined && !(Array.isArray(value.columns) && value.columns.length <= 50 && value.columns.every((c) => typeof c === "string" && c.trim() !== ""))) return "Columns are a list of up to 50 property names";
      if (value.limit !== undefined && !(typeof value.limit === "number" && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= COLLECTION_LIMITS.shown)) return `A limit is a number from 1 to ${COLLECTION_LIMITS.shown}`;
      return null;
    }
    default:
      return `A collection’s “${key}” cannot be changed here: only ${KEYS.join(", ")} can`;
  }
}

/** A collection's name, trimmed, or why it is not allowed. */
export function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("A collection needs a name");
  if (trimmed.length > COLLECTION_LIMITS.name || !plain(trimmed)) throw new Error(`A collection’s name is one line of at most ${COLLECTION_LIMITS.name} characters`);
  return trimmed;
}

/** The value of each top-level key in a collection's text (one-line values, flow maps and lists, and block lists or maps). */
function topLevel(text: string): Record<string, Flow | undefined> {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  const out: Record<string, Flow | undefined> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let rest = match[2]!.trim();
    // A comment after the value, but not inside a quoted one.
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : null;
    if (quote) {
      const close = rest.indexOf(quote, 1);
      if (close > 0) rest = rest.slice(0, close + 1);
    } else rest = rest.replace(/\s+#.*$/, "");
    if (rest !== "" && !/^[>|]/.test(rest)) {
      out[key] = readFlow(rest);
      continue;
    }
    // A block: indented lines, or `- ` items at the left edge.
    const items: Flow[] = [];
    const map: Record<string, Flow> = {};
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      const item = /^[ \t]*-[ \t]+(.*)$/.exec(next);
      const pair = /^[ \t]+([^:#\s][^:#]*):[ \t]*(.*)$/.exec(next);
      if (item) items.push(readFlow(item[1]!.replace(/\s+#.*$/, "")));
      else if (pair) map[pair[1]!.trim()] = readFlow(pair[2]!.replace(/\s+#.*$/, ""));
      else if (next.trim() !== "" && !/^[ \t]/.test(next)) break;
    }
    out[key] = items.length > 0 ? items : Object.keys(map).length > 0 ? map : null;
  }
  return out;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The collection a file holds; what cannot be used is listed with the reason. */
export function readCollection(path: string, text: string, modified: number): Collection {
  const slug = slugOf(path);
  const found: Collection = { path, slug, name: slug, icon: null, query: "", when: null, filter: [], sort: [], display: null, format: FORMAT, hash: contentHash(text), modified, problem: null, readOnly: false };
  const stop = (why: string) => {
    found.problem = why;
    found.readOnly = true;
    return found;
  };
  if (text.trim() === "") return stop("This file holds no collection");
  if (/^\s*[{[]/.test(text) || !/^[A-Za-z_][\w-]*[ \t]*:/m.test(text)) return stop("This file holds no collection");
  const top = topLevel(text);
  const format = top.format;
  if (format !== undefined && format !== null) {
    if (typeof format === "number" && Number.isInteger(format) && format >= 1) found.format = format;
    else return stop("Its format is not a version number");
  }
  found.name = textOrNull(top.name) ?? slug;
  found.icon = textOrNull(top.icon);
  found.query = typeof top.query === "string" ? top.query : "";
  found.when = (top.when ?? null) as Collection["when"];
  found.filter = Array.isArray(top.filter) ? (top.filter as unknown as Collection["filter"]) : [];
  found.sort = Array.isArray(top.sort) ? (top.sort as unknown as Collection["sort"]) : [];
  found.display = (top.display ?? null) as Collection["display"];
  for (const key of KEYS) {
    const value = top[key];
    if (value === undefined || value === null) continue;
    const why = checkValue(key, value);
    if (why) return stop(why);
  }
  if (found.format > FORMAT) return stop(`Made by a newer version of KastenFlow (format ${found.format}; this one reads up to ${FORMAT})`);
  return found;
}

/** `text` with `edits` made: each key set to its value, or taken out when `null`; nothing else changes. */
export function editCollectionText(text: string, edits: CollectionEdits): string {
  for (const [key, value] of Object.entries(edits)) {
    if (value === null || value === undefined) {
      if (!(KEYS as readonly string[]).includes(key)) throw new Error(checkValue(key, value)!);
      continue;
    }
    const why = checkValue(key, value);
    if (why) throw new Error(why);
  }
  let out = text;
  for (const key of KEYS) {
    const value = (edits as Record<string, unknown>)[key];
    if (value !== undefined) out = setValue(out, key, value === null ? undefined : value);
  }
  return out;
}

/** The text of a new collection called `name` with `edits` made. */
export function newCollectionText(name: string, edits: CollectionEdits): string {
  return editCollectionText(`format: ${FORMAT}\nname: ${writeFlow(checkName(name))}\n`, edits);
}
