// What the Graph view remembers in this window: the scope, how deep around a
// page, how nodes are coloured, where a plain click opens, and the filters.
// A convenience only: it falls back to the defaults when storage will not say.

import { useCallback, useState } from "react";

import { isOpens, type Opens } from "../workspace/opens";
import { SHOW_ALL, type ColourBy, type GraphFilters } from "./graph-model";

export type ScopeChoice = "vault" | "project" | "page";

/** `auto`: the way Settings opens links, and to the right when that is the same tab. */
export type GraphOpens = "auto" | Opens;

export interface GraphPrefs {
  scope: ScopeChoice;
  depth: 1 | 2 | 3;
  colourBy: ColourBy;
  opens: GraphOpens;
  filters: GraphFilters;
}

export const DEFAULT_PREFS: GraphPrefs = { scope: "vault", depth: 1, colourBy: "kind", opens: "auto", filters: SHOW_ALL };

const KEY = "kasten.graph";

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Reads saved preferences, taking only what is valid. */
export function readPrefs(raw: unknown): GraphPrefs {
  const saved = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const filters = (typeof saved.filters === "object" && saved.filters !== null ? saved.filters : {}) as Record<string, unknown>;
  return {
    scope: saved.scope === "project" || saved.scope === "page" ? saved.scope : "vault",
    depth: saved.depth === 2 || saved.depth === 3 ? saved.depth : 1,
    colourBy: saved.colourBy === "project" ? "project" : "kind",
    opens: saved.opens === "auto" || isOpens(saved.opens) ? saved.opens : "auto",
    filters: {
      orphans: filters.orphans !== false,
      ghosts: filters.ghosts !== false,
      hiddenKinds: strings(filters.hiddenKinds),
      tags: strings(filters.tags),
    },
  };
}

function load(): GraphPrefs {
  try {
    return readPrefs(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_PREFS;
  }
}

function save(prefs: GraphPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // The choices last until the window closes.
  }
}

/** The view's preferences and a way to change some of them. */
export function useGraphPrefs(): [GraphPrefs, (patch: Partial<GraphPrefs>) => void] {
  const [prefs, setPrefs] = useState<GraphPrefs>(load);
  const patch = useCallback((change: Partial<GraphPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      save(next);
      return next;
    });
  }, []);
  return [prefs, patch];
}
