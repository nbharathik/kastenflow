// How the Card Library was left: grid or table, the sort and the filters.
// A per-window convenience in the browser's storage; anything unreadable
// falls back to the defaults.

import { useCallback, useEffect, useRef, useState } from "react";

import { readDateFilter } from "./date-filter";
import { KINDS, NO_FILTERS, SORT_LABELS, type Filters, type Sort } from "./filters";
import { readGroupBy, type GroupBy } from "./groups";

export type Mode = "grid" | "table";

export interface LibraryPrefs {
  mode: Mode;
  sort: Sort;
  filters: Filters;
  /** How the cards are grouped under headings. */
  group: GroupBy;
}

export const DEFAULT_PREFS: LibraryPrefs = { mode: "grid", sort: { key: "updated", dir: "desc" }, filters: NO_FILTERS, group: "none" };

const KEY = "kasten.library";

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Stored JSON as prefs, keeping only values that make sense. */
export function readPrefs(raw: string | null): LibraryPrefs {
  let saved: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    saved = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return DEFAULT_PREFS;
  }
  const sort = (saved.sort ?? {}) as Record<string, unknown>;
  const filters = (saved.filters ?? {}) as Record<string, unknown>;
  return {
    mode: oneOf(saved.mode, ["grid", "table"], DEFAULT_PREFS.mode),
    sort: {
      key: oneOf(sort.key, Object.keys(SORT_LABELS) as Sort["key"][], DEFAULT_PREFS.sort.key),
      dir: oneOf(sort.dir, ["asc", "desc"], DEFAULT_PREFS.sort.dir),
    },
    filters: {
      kind: oneOf(filters.kind, KINDS.map((k) => k.id), NO_FILTERS.kind),
      place: text(filters.place),
      tag: text(filters.tag)?.toLowerCase() ?? null,
      updated: readDateFilter(filters.updated),
      created: readDateFilter(filters.created),
      noBoard: filters.noBoard === true,
      orphans: filters.orphans === true,
    },
    group: readGroupBy(saved.group),
  };
}

export function loadPrefs(): LibraryPrefs {
  try {
    return readPrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: LibraryPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be full or off; the library still works, it just forgets.
  }
}

/** The library's prefs, saved whenever they change. */
export function useLibraryPrefs(): [LibraryPrefs, (patch: Partial<LibraryPrefs>) => void] {
  const [prefs, setPrefs] = useState(loadPrefs);
  const loaded = useRef(prefs);
  useEffect(() => {
    if (prefs !== loaded.current) savePrefs(prefs);
  }, [prefs]);
  const update = useCallback((patch: Partial<LibraryPrefs>) => setPrefs((current) => ({ ...current, ...patch })), []);
  return [prefs, update];
}
