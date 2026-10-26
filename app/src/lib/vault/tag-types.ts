// Tags, their schemas and views, and how connected notes are (serde,
// camelCase where the core sends it). `types.ts` re-exports all of them.

/** How connected a note is (Card Library). */
export interface NoteStats {
  path: string;
  /** Notes linking to it. */
  backlinks: number;
  /** Links it makes. */
  links: number;
  /** Boards showing it. */
  boards: number;
}

/** A property in a tag's schema, `tags/<name>.yaml`. */
export interface PropDef {
  key: string;
  /** text, number, select, multi_select, date, checkbox, url, relation or formula. */
  type: string;
  options: string[];
  /** A formula property: what it calculates, e.g. `days_until(deadline)`. */
  formula?: string;
}

/** The calculated cells of a tag's rows (kasten-app `FormulaFill`). */
export interface FormulaFill {
  /** Per note path, the formula keys and their values (null when a cell has none). */
  values: Record<string, Record<string, unknown>>;
  /** Per note path and formula key, why a cell has no value. */
  problems: Record<string, Record<string, string>>;
}

/** What is wrong with a formula as typed, and where (1-based). */
export interface FormulaIssue {
  position: number;
  message: string;
}

export interface TagSchema {
  name: string;
  color: string | null;
  properties: PropDef[];
  /** Views as written: {name, type: table | kanban | list | calendar, ...}. */
  views: Record<string, unknown>[];
  path: string;
}

export type TagViewKind = "table" | "kanban" | "list" | "calendar" | "gallery" | "timeline";

/** How a view narrows its notes: `is`, `is_not`, `contains`, `empty`,
 * `not_empty`, `before` or `after` (dates), `gt`, `gte`, `lt` or `lte`
 * (numbers) against `value`. */
export interface ViewFilter {
  key: string;
  op: "is" | "is_not" | "contains" | "empty" | "not_empty" | "before" | "after" | "gt" | "gte" | "lt" | "lte";
  value?: unknown;
}

/** A tag database view as saved in the tag's YAML. */
export interface TagView {
  name: string;
  type: TagViewKind;
  /** Kanban: the select property whose options are the columns. */
  group_by?: string;
  /** Calendar: the date property it places notes by. */
  date?: string;
  /** Timeline: the date property bars begin at, the one they end at (none: a
   * marker), and how much time fits across the screen. */
  start?: string;
  end?: string;
  scale?: "week" | "month" | "quarter";
  sort?: { key: string; dir: "asc" | "desc" }[];
  filter?: ViewFilter[];
  /** Table: the properties shown, in order. */
  columns?: string[];
  /** Table: show a note's sub-items (notes whose `parent` is it) under it. Off when absent. */
  sub_items?: boolean;
  /** The ids of the notes in the order a person put them by dragging (kept with `set_view_order`); read only while the view has no sort. Ids no row has are ignored and rows it lacks follow at the end. */
  order?: string[];
  /** Board, list, gallery and timeline: leave out notes that are sub-items of another row. */
  hide_sub_items?: boolean;
  /** Table: a calculation per column (`{points: "sum"}`); the calculations row shows when this is set. */
  calcs?: Record<string, string>;
  /** Table: wrap cells to two lines, row density, and whether the title column stays in view (on unless false). */
  wrap?: boolean;
  density?: "compact" | "comfortable";
  freeze_title?: boolean;
  /** With several filters: keep a note that passes all of them (the default) or any one. */
  filter_mode?: "all" | "any";
  /** Keys other tools wrote stay as they were. */
  [key: string]: unknown;
}

/** A starter kit the app offers (kasten-core `KitInfo`). */
export interface KitInfo {
  id: string;
  /** An emoji, as its home page has. */
  icon: string;
  name: string;
  summary: string;
  /** The page that explains it, opened once it is added. */
  home: string;
  recommended: boolean;
  /** Where each of its files goes in the vault. */
  files: string[];
}

/** What adding a starter kit did (kasten-core `AddedKit`). */
export interface AddedKit {
  home: string;
  written: string[];
  /** The vault's own files at the kit's paths, left as they were. */
  kept: string[];
  /** Its commit, for Undo; none in the browser preview. */
  commit: string | null;
}
