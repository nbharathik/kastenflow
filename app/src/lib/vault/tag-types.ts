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
  /** text, number, select, multi_select, date, checkbox, url or relation. */
  type: string;
  options: string[];
}

export interface TagSchema {
  name: string;
  color: string | null;
  properties: PropDef[];
  /** Views as written: {name, type: table | kanban | list | calendar, ...}. */
  views: Record<string, unknown>[];
  path: string;
}

export type TagViewKind = "table" | "kanban" | "list" | "calendar" | "gallery";

/** How a view narrows its notes: `is`, `is_not`, `contains`, `empty`,
 * `not_empty`, `before` or `after` (dates) against `value`. */
export interface ViewFilter {
  key: string;
  op: "is" | "is_not" | "contains" | "empty" | "not_empty" | "before" | "after";
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
  sort?: { key: string; dir: "asc" | "desc" }[];
  filter?: ViewFilter[];
  /** Table: the properties shown, in order. */
  columns?: string[];
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
