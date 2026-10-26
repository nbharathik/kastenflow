// A grouped table: the rows laid out group by group with a header row before
// each, the groups folded shut (remembered while the window is open), and the
// numbers each header and the foot show. The rows and the headers are the
// windowed list's items; the grid still moves over the notes alone.

import { useCallback, useMemo, useReducer } from "react";

import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { relatedNote } from "../../../panel/links/related";
import { titleOf } from "../../../workspace/names";
import { useWorkspace } from "../../../workspace/store";
import { calcOf, calculate, calcText, kindOf } from "./calc";
import type { Column } from "./columns";
import { groupId, groupSpec, inheritedIds, membersOf, partition, type GroupSpec } from "./group";
import type { FlatRow } from "./subitems";
import type { SubTable } from "./useSubTable";

/** A group's header row. */
export interface GroupHead {
  id: string | null;
  label: string;
  /** The notes in the group, sub-items shut or open. */
  count: number;
  collapsed: boolean;
  /** The group's calculations by column key, as the header says them. */
  calcs: Readonly<Record<string, string>>;
}

/** What the windowed list draws at one place: a row (its place among the notes) or a group header. */
export type Item = number | GroupHead;

export interface Grouped {
  spec: GroupSpec;
  /** The notes shown (the folded groups' left out), in the order drawn. */
  rows: NoteMeta[];
  meta: FlatRow[] | null;
  items: Item[];
  /** Per note row, its place among the items. */
  itemOf: number[];
  /** Per note row, its group. */
  groupOf: (string | null)[];
  toggle(id: string | null): void;
  /** Shuts a group (or opens it, when `shut` is false). */
  fold(id: string | null, shut: boolean): void;
  /** Folds every group shut, or opens them all. */
  setAll(collapsed: boolean): void;
  /** Every group's id, in order. */
  ids: (string | null)[];
}

const NONE = "\u0000none";
const key = (id: string | null) => id ?? NONE;
const EMPTY: ReadonlySet<string> = new Set();

/** Which groups are shut, per table, for as long as the window is open. */
const folded = new Map<string, ReadonlySet<string>>();
const MAX_FOLDED = 100;

export function useGroups(tag: string, view: TagView, schema: TagSchema | null, columns: readonly Column[], listed: readonly NoteMeta[], pool: readonly NoteMeta[] | undefined, sub: SubTable): Grouped | null {
  const spec = useMemo(() => groupSpec(view, schema), [view, schema]);
  const place = `${tag.toLowerCase()}|${view.name}`;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const shut = folded.get(place) ?? EMPTY;
  // Relations are ids; the header says the note's title.
  const notesOfVault = useWorkspace((s) => (spec?.kind === "relation" ? s.notes : null));

  const built = useMemo(() => {
    if (!spec) return null;
    const resolve = notesOfVault
      ? (id: string) => {
          const note = relatedNote(notesOfVault, id);
          return note ? titleOf(note) : id;
        }
      : undefined;
    const rows = sub.rows;
    const meta = sub.meta;
    const ids = meta ? inheritedIds(meta, spec) : rows.map((n) => groupId(n, spec));
    const groups = partition(
      rows.map((_, i) => i),
      ids,
      spec,
      resolve,
    );
    const members = membersOf(listed, pool ?? listed, spec, meta !== null);
    const calced = columns.flatMap((c) => {
      const fn = calcOf(view, c);
      return fn ? [{ column: c, fn, kind: kindOf(c) }] : [];
    });
    const out: NoteMeta[] = [];
    const outMeta: FlatRow[] | null = meta ? [] : null;
    const items: Item[] = [];
    const itemOf: number[] = [];
    const groupOf: (string | null)[] = [];
    for (const group of groups) {
      const all = members.get(group.id) ?? [];
      const calcs: Record<string, string> = {};
      for (const { column, fn, kind } of calced) calcs[column.key] = calcText(fn, calculate(fn, all, column.key, kind));
      const collapsed = shut.has(key(group.id));
      items.push({ id: group.id, label: group.label, count: all.length, collapsed, calcs });
      if (collapsed) continue;
      for (const i of group.items) {
        itemOf.push(items.length);
        items.push(out.length);
        out.push(rows[i]!);
        outMeta?.push(meta![i]!);
        groupOf.push(group.id);
      }
    }
    return { rows: out, meta: outMeta, items, itemOf, groupOf, ids: groups.map((g) => g.id) };
  }, [spec, sub.rows, sub.meta, listed, pool, columns, view, shut, notesOfVault]);

  const change = useCallback(
    (next: ReadonlySet<string>) => {
      folded.delete(place);
      folded.set(place, next);
      if (folded.size > MAX_FOLDED) folded.delete(folded.keys().next().value!);
      redraw();
    },
    [place],
  );
  const ids = built?.ids;
  const api = useMemo(
    () => ({
      toggle(id: string | null) {
        const next = new Set(folded.get(place) ?? EMPTY);
        if (!next.delete(key(id))) next.add(key(id));
        change(next);
      },
      fold(id: string | null, shut: boolean) {
        const next = new Set(folded.get(place) ?? EMPTY);
        if (shut) next.add(key(id));
        else next.delete(key(id));
        change(next);
      },
      setAll(collapsed: boolean) {
        change(collapsed ? new Set((ids ?? []).map(key)) : EMPTY);
      },
    }),
    [place, change, ids],
  );
  if (!spec || !built) return null;
  return { spec, ...built, ...api };
}
