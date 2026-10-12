// What the overview remembers in this window for each project: the tab it was
// on, table or gallery, the sort and the filters of the All tab. A convenience:
// the saved tables themselves live in the project page.

import { useCallback, useState } from "react";

import { readDateFilter } from "../../library/date-filter";
import { DEFAULT_SORT, NO_FILTERS, type ItemFilters, type Sort, type SortKey } from "./items";

export type Mode = "table" | "gallery";

export interface OverviewPrefs {
  /** `all`, `captures`, `tasks`, `graph`, or `table:<name>`. */
  tab: string;
  mode: Mode;
  sort: Sort;
  filters: ItemFilters;
}

export const DEFAULT_PREFS: OverviewPrefs = { tab: "all", mode: "table", sort: DEFAULT_SORT, filters: NO_FILTERS };

const KEY = (folder: string) => `kasten.overview:${folder}`;
const SORT_KEYS: readonly SortKey[] = ["updated", "created", "title", "type"];
const KINDS = ["all", "page", "card", "board", "deck"] as const;

/** Reads saved preferences, taking only what is valid. */
export function readPrefs(raw: unknown): OverviewPrefs {
  const saved = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const sort = (typeof saved.sort === "object" && saved.sort !== null ? saved.sort : {}) as Record<string, unknown>;
  const filters = (typeof saved.filters === "object" && saved.filters !== null ? saved.filters : {}) as Record<string, unknown>;
  return {
    tab: typeof saved.tab === "string" && saved.tab ? saved.tab : "all",
    mode: saved.mode === "gallery" ? "gallery" : "table",
    sort: SORT_KEYS.includes(sort.key as SortKey) ? { key: sort.key as SortKey, dir: sort.dir === "asc" ? "asc" : "desc" } : DEFAULT_SORT,
    filters: {
      kind: (KINDS as readonly unknown[]).includes(filters.kind) ? (filters.kind as ItemFilters["kind"]) : "all",
      tag: typeof filters.tag === "string" && filters.tag ? filters.tag : null,
      updated: readDateFilter(filters.updated),
      created: readDateFilter(filters.created),
    },
  };
}

function load(folder: string): OverviewPrefs {
  try {
    return readPrefs(JSON.parse(localStorage.getItem(KEY(folder)) ?? "null"));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** The project's overview preferences and a way to change some of them. */
export function useOverviewPrefs(folder: string): [OverviewPrefs, (patch: Partial<OverviewPrefs>) => void] {
  const [prefs, setPrefs] = useState<OverviewPrefs>(() => load(folder));
  const patch = useCallback(
    (change: Partial<OverviewPrefs>) => {
      setPrefs((current) => {
        const next = { ...current, ...change };
        try {
          localStorage.setItem(KEY(folder), JSON.stringify(next));
        } catch {
          // The choices last until the window closes.
        }
        return next;
      });
    },
    [folder],
  );
  return [prefs, patch];
}
