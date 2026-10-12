// More of what the palette finds: PDFs by title, Settings groups by name,
// and the searches run lately, offered again when the palette opens.

import { inTauri } from "../../../lib/api";
import type { SourceInfo } from "../../../lib/vault/types";
import { lineIcon } from "../../../ui/glyph";
import { useWorkspace, type OpenHow } from "../store";
import { ENTRIES, GROUPS, groupById, isOffered } from "../views/settings/index";
import { openSettingsAt } from "../views/settings/jump";
import { score } from "./match";

export interface Row {
  key: string;
  icon: string;
  label: string;
  detail?: string;
  hint?: string;
  /** The palette stays open: the row shows more in it. */
  stay?: boolean;
  /** Pages open where `how` says: Ctrl for a tab, Shift for the stack, Alt for a split. */
  run(how: OpenHow): void;
}

const KEY = "kasten.palette.searches";
const KEPT = 5;

/** PDFs whose titles match `q`, best first. */
export function pdfRows(sources: readonly SourceInfo[] | null, q: string): Row[] {
  if (!sources || !q) return [];
  return sources
    .map((source) => ({ source, s: score(source.title, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ source }) => ({
      key: `pdf:${source.path}`,
      icon: lineIcon("book"),
      label: source.title,
      detail: "PDF",
      run: (how) => useWorkspace.getState().go({ view: "highlights", path: source.path }, how),
    }));
}

/** Settings named by `q`, which may start with "settings": the groups by their
 * titles, and, when the query does start so, single settings of other groups,
 * each opening Settings right there. Without the word, single settings stay out:
 * a setting called "Notes trashed per session" must not beat the Trash command. */
export function settingsRows(q: string): Row[] {
  const explicit = /^settings?\b/i.test(q);
  const wanted = q.replace(/^settings?\b[\s:]*/i, "");
  if (wanted.length < 2) return [];
  const groups = GROUPS.map((group) => ({ group, s: score(group.title, wanted) }))
    .filter((x) => x.s >= 40)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  const rows: Row[] = groups.map(({ group }) => ({ key: `settings:${group.title}`, icon: lineIcon("settings"), label: `Settings: ${group.title}`, run: (how) => openSettingsAt({ group: group.id }, how) }));
  if (!explicit) return rows;
  const named = new Set(groups.map((x) => x.group.id));
  const desktop = inTauri();
  const single = ENTRIES.filter((e) => isOffered(e, desktop) && !named.has(e.group))
    .map((entry) => ({ entry, s: score(entry.label, wanted) }))
    .filter((x) => x.s >= 60)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  for (const { entry } of single) {
    rows.push({ key: `setting:${entry.id}`, icon: lineIcon("settings"), label: entry.label, detail: `Settings · ${groupById(entry.group).title}`, run: (how) => openSettingsAt({ group: entry.group, row: entry.id }, how) });
  }
  return rows;
}

/** The searches run lately, newest first. */
export function recentSearches(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(kept) ? kept.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, KEPT) : [];
  } catch {
    return [];
  }
}

/** Keeps `query` as the latest search. */
export function keepSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([q, ...recentSearches().filter((k) => k !== q)].slice(0, KEPT)));
  } catch {
    // The palette opens without them next time.
  }
}
