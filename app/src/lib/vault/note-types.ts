// Notes as the frontend sees them: the shapes kasten-core's note ops return
// (serde, camelCase). `types.ts` re-exports all of them.

export type NoteKind = "page" | "card" | "journal" | "project" | "highlight" | "chat";

export interface NoteMeta {
  /** Vault-relative path; the note's handle in every call. */
  path: string;
  id: string | null;
  title: string;
  /** `page`, `card`, `journal`, `project` or `template`. */
  kind: string;
  icon: string | null;
  cover: string | null;
  /** Id of the parent page, for sub-pages. */
  parent: string | null;
  /** Folder name under `projects/`. */
  project: string | null;
  tags: string[];
  /** Last change, in milliseconds since the Unix epoch. */
  modified: number;
  /** `created` and `updated` from the frontmatter, as written. */
  created: string | null;
  updated: string | null;
  /** The first readable text, for cards and previews. */
  excerpt: string;
  words: number;
  /** Tag property values. */
  props: Record<string, unknown>;
  /** Read-only for agents. */
  locked: boolean;
  /** For a page: the ids of its sub-pages in the order they show; those it
   * does not name come after, alphabetically. */
  childrenOrder?: string[];
}

export interface NoteFile {
  meta: NoteMeta;
  text: string;
  /** Pass back when saving, so changes made meanwhile are noticed. */
  hash: string;
}

/** A note after an op that can move files: every [from, to] move the op
 * made, its sub-pages' included, and the other notes whose links it
 * rewrote. */
export interface Placed extends NoteFile {
  moves: [string, string][];
  relinked: string[];
}

export type Saved =
  | { status: "written"; note: NoteFile }
  | { status: "unchanged"; note: NoteFile }
  | { status: "conflict"; copy: string; note: NoteFile }
  /** The file changed elsewhere on other lines; both edits were kept. */
  | { status: "merged"; note: NoteFile };

export interface NewNote {
  kind: NoteKind;
  title: string;
  /** The local day, YYYY-MM-DD. */
  date: string;
  project?: string | null;
  /** Path of the parent page. */
  parent?: string | null;
  template?: string | null;
  icon?: string | null;
  /** Tags to add, and property values checked against their schemas: all
   * in the one commit that makes the note. */
  tags?: string[];
  props?: Record<string, unknown>;
  /** What the page says, written with it in the same commit: a draft's
   * first typing. */
  body?: string;
}

export interface Hit {
  path: string;
  title: string;
  icon: string | null;
  snippet: string;
  score: number;
}

/** A note that links a day (`[[2026-10-01]]`) outside a to-do. */
export interface DayMention {
  day: string;
  path: string;
  title: string;
  icon: string | null;
  /** `page`, `card`, `journal` or `project`, as in `NoteMeta`. */
  kind: string;
  /** The line that holds the link. */
  snippet: string;
  /** The time, `HH:MM`, written directly after the link
   * (`[[2026-10-07]] 09:00`), if any. */
  at?: string | null;
}

export interface Backlink {
  path: string;
  title: string;
  icon: string | null;
  snippet: string;
}

/** A note about the same things as another (the core's related notes). */
export interface RelatedNote {
  path: string;
  title: string;
  icon: string | null;
  /** Up to three words both notes use, the most telling first. */
  shared: string[];
  /** One links to the other already. */
  linked: boolean;
}

export interface Renamed {
  note: NoteFile;
  /** Other notes whose links now name the new title. */
  relinked: string[];
}

export interface Trashed {
  trashed: string;
  original: string;
  title: string;
  when: string;
  /** How many sub-pages went to the trash with it; they come back with it. */
  inside: number;
}

export interface TaskRow {
  path: string;
  title: string;
  icon: string | null;
  /** Line in the body, from 0. */
  line: number;
  done: boolean;
  text: string;
  /** The day the task names, YYYY-MM-DD (a day that exists on the calendar). */
  due: string | null;
  /** The time, `HH:MM` (24 hours), that directly follows that day link or
   * `@date` (`[[2026-10-07]] 09:00`), if any. */
  at?: string | null;
}

/** The frontmatter keys `setMeta` changes. */
export type MetaField = "title" | "icon" | "cover" | "font" | "width" | "text" | "locked" | "opens" | "layout";
