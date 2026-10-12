// Grouping the Library's cards: by type, project, first tag, month or week
// (of the date the list is sorted by, else of when each was last changed).
// Groups come in a fixed order, the cards inside each in the list's own.

import { isoDay, stampDay, startOfWeek } from "../../lib/dates";
import { KINDS, kindLabel, type Row, type Sort } from "./filters";
import { monthName } from "./date-filter";

export type GroupBy = "none" | "type" | "project" | "tag" | "month" | "week";

export const GROUPS: readonly { id: GroupBy; label: string }[] = [
  { id: "none", label: "No groups" },
  { id: "type", label: "Type" },
  { id: "project", label: "Project" },
  { id: "tag", label: "Tag" },
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
];

export const readGroupBy = (value: unknown): GroupBy => (GROUPS.some((g) => g.id === value) ? (value as GroupBy) : "none");

/** One headed run of cards. */
export interface Group {
  /** Unique across the modes, so folding one group never folds another's. */
  key: string;
  label: string;
  /** The group's cards, or none while it is folded. */
  rows: Row[];
  /** How many cards it holds, folded or not. */
  count: number;
  folded: boolean;
}

export interface GroupContext {
  weekStart?: number;
  sort: Sort;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The date a month or week group reads: when each was made if the list is
 * sorted by that, else when it was last changed. */
const dateOfRow = (row: Row, sort: Sort): number | null => (sort.key === "created" ? row.created : row.updated);

interface Keyed {
  key: string;
  label: string;
  /** Orders groups: by the number first, then by the text. */
  order: number;
  text: string;
}

function keyed(row: Row, by: Exclude<GroupBy, "none">, { weekStart = 1, sort }: GroupContext): Keyed {
  switch (by) {
    case "type": {
      const kind = row.note.kind || "page";
      const at = KINDS.findIndex((k) => k.id === kind);
      const known = KINDS[at];
      return { key: `type:${kind}`, label: known && known.id !== "all" ? known.label : `${kindLabel(kind)}s`, order: at < 0 ? KINDS.length : at, text: kind };
    }
    case "project":
      return { key: `project:${row.place}`, label: row.placeLabel, order: 0, text: row.placeLabel };
    case "tag": {
      const tag = row.note.tags[0];
      return tag === undefined ? { key: "tag:", label: "No tag", order: 1, text: "" } : { key: `tag:${tag.toLowerCase()}`, label: `#${tag}`, order: 0, text: tag };
    }
    case "month":
    case "week": {
      const millis = dateOfRow(row, sort);
      if (millis === null) return { key: `${by}:`, label: "No date", order: 1, text: "" };
      const date = new Date(millis);
      if (by === "month") {
        const month = isoDay(date).slice(0, 7);
        return { key: `month:${month}`, label: monthName(month), order: 0, text: month };
      }
      const first = isoDay(startOfWeek(date, weekStart));
      return { key: `week:${first}`, label: `Week of ${stampDay(first)}`, order: 0, text: first };
    }
  }
}

/** `rows` in headed groups. Month and week groups run newest first, unless the
 * list is sorted by a date, oldest first; the others by name. "No tag" and
 * "No date" come last. With `none` it is one group with no label. Folded
 * groups (by key) hold no rows but still count them. */
export function groupRows(rows: readonly Row[], by: GroupBy, context: GroupContext, folded: ReadonlySet<string> = new Set()): Group[] {
  if (by === "none") return [{ key: "", label: "", rows: [...rows], count: rows.length, folded: false }];
  const groups = new Map<string, { head: Keyed; rows: Row[] }>();
  for (const row of rows) {
    const head = keyed(row, by, context);
    const found = groups.get(head.key);
    if (found) found.rows.push(row);
    else groups.set(head.key, { head, rows: [row] });
  }
  const byDate = by === "month" || by === "week";
  const oldestFirst = byDate && ["updated", "created"].includes(context.sort.key) && context.sort.dir === "asc";
  const sorted = [...groups.values()].sort((a, b) => {
    if (a.head.order !== b.head.order) return a.head.order - b.head.order;
    if (byDate) return (oldestFirst ? 1 : -1) * (a.head.text < b.head.text ? -1 : a.head.text > b.head.text ? 1 : 0);
    return collator.compare(a.head.text, b.head.text);
  });
  return sorted.map(({ head, rows: inside }) => {
    const isFolded = folded.has(head.key);
    return { key: head.key, label: head.label, rows: isFolded ? [] : inside, count: inside.length, folded: isFolded };
  });
}

/** The cards on show, in the order they are drawn. */
export const shownRows = (groups: readonly Group[]): Row[] => groups.flatMap((g) => g.rows);

/** The groups with at most `limit` cards between them (a group the limit
 * falls inside is cut short; later ones keep their heads and hold none). */
export function limitGroups(groups: readonly Group[], limit: number): Group[] {
  let left = limit;
  return groups.map((group) => {
    if (group.rows.length <= left) {
      left -= group.rows.length;
      return group;
    }
    const rows = group.rows.slice(0, Math.max(0, left));
    left = 0;
    return { ...group, rows };
  });
}
