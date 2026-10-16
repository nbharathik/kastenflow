// The sidebar's view of the vault: projects with their pages, loose pages,
// sub-pages under their parent, notes in other folders by folder, and
// lookups by title.
//
// Every answer comes from one index per notes array, built once and cached
// (tree-index.ts), so a sidebar of thousands of rows asks in constant time.

import type { NoteMeta } from "../../lib/vault/types";
import { treeOf } from "./tree-index";
import { EMPTY } from "./tree-parts";

export { build, treeOf } from "./tree-index";
export { KASTEN_FOLDERS, inOtherFolder } from "./tree-types";
export type { FolderNode, TreeIndex } from "./tree-types";

export const noteAt = (notes: readonly NoteMeta[], path: string): NoteMeta | undefined => treeOf(notes).byPath.get(path);

/** Notes a person opens: everything but templates. */
export const openable = (notes: readonly NoteMeta[]) => treeOf(notes).openable;

export const templates = (notes: readonly NoteMeta[]) => treeOf(notes).templates;

/** A template's name for the core: its file name without `.md`. */
export const templateName = (note: NoteMeta) => note.path.slice("templates/".length, -".md".length);

export const projects = (notes: readonly NoteMeta[]) => treeOf(notes).projects;

/** Sub-pages of `note`, by the id in their `parent` key. */
export function childrenOf(notes: readonly NoteMeta[], note: NoteMeta): NoteMeta[] {
  if (!note.id) return EMPTY;
  const index = treeOf(notes);
  // Only the note that owns the id has children (ids are unique).
  if (index.byId.get(note.id)?.path !== note.path) return EMPTY;
  return index.children.get(note.id) ?? EMPTY;
}

/** The note at `path` and every sub-page below it, parents first: what
 * goes to the trash with it. */
export function withSubPages(notes: readonly NoteMeta[], path: string): string[] {
  const root = notes.find((n) => n.path === path);
  if (!root) return [path];
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    for (const child of childrenOf(notes, out[i]!)) if (!out.includes(child)) out.push(child);
  }
  return out.map((n) => n.path);
}

/** A project's own pages and cards, sub-pages left to their parents. */
export function projectNotes(notes: readonly NoteMeta[], project: NoteMeta): NoteMeta[] {
  if (!project.project) return EMPTY;
  const list = treeOf(notes).projectPages.get(project.project) ?? EMPTY;
  return list.some((n) => n.path === project.path) ? list.filter((n) => n.path !== project.path) : list;
}

const joined = new WeakMap<NoteMeta[], { extra: NoteMeta[]; rows: NoteMeta[] }>();

/** What nests under a row in the sidebar: a project's pages and cards, or
 * a page's sub-pages. The same array while those lists do not change. */
export function rowsUnder(notes: readonly NoteMeta[], note: NoteMeta): NoteMeta[] {
  const subPages = childrenOf(notes, note);
  if (note.kind !== "project") return subPages;
  const own = projectNotes(notes, note);
  if (subPages.length === 0) return own;
  if (own.length === 0) return subPages;
  const known = joined.get(own);
  if (known?.extra === subPages) return known.rows;
  const rows = [...own, ...subPages];
  joined.set(own, { extra: subPages, rows });
  return rows;
}

/** Pages outside projects, the journal and the inbox. */
export const loosePages = (notes: readonly NoteMeta[]) => treeOf(notes).loose;

/** Notes in folders that are not Kasten's own, by folder. */
export const noteFolders = (notes: readonly NoteMeta[]) => treeOf(notes).folders;

export const inboxCards = (notes: readonly NoteMeta[]) => treeOf(notes).inbox;

export const journalDays = (notes: readonly NoteMeta[]) => treeOf(notes).journal;

export function findByTitle(notes: readonly NoteMeta[], title: string): NoteMeta | undefined {
  return treeOf(notes).titles.get(title.trim().toLowerCase());
}

/** The chain of parents above `note`, outermost first. */
export function ancestors(notes: readonly NoteMeta[], note: NoteMeta): NoteMeta[] {
  const { byId } = treeOf(notes);
  const out: NoteMeta[] = [];
  const seen = new Set<string>([note.path]);
  let current = note;
  while (current.parent) {
    const parent = byId.get(current.parent);
    if (!parent || seen.has(parent.path)) break;
    seen.add(parent.path);
    out.unshift(parent);
    current = parent;
  }
  return out;
}

/** Whether `path` is `root` or sits below it in the sub-page tree. */
export function isWithin(notes: readonly NoteMeta[], path: string, root: NoteMeta): boolean {
  const note = treeOf(notes).byPath.get(path);
  if (!note) return false;
  return note.path === root.path || ancestors(notes, note).some((a) => a.path === root.path);
}

let held: { notes: readonly NoteMeta[]; current: string | undefined; paths: Set<string> } | null = null;

/** Rows that contain the open page and so stay expanded: its parents and
 * its project. Cached for the last notes and page asked about. */
export function holders(notes: readonly NoteMeta[], current: string | undefined): Set<string> {
  if (held && held.notes === notes && held.current === current) return held.paths;
  const paths = new Set<string>();
  const note = current ? treeOf(notes).byPath.get(current) : undefined;
  if (note) {
    for (const a of ancestors(notes, note)) paths.add(a.path);
    const project = note.project ? treeOf(notes).projectNote.get(note.project) : undefined;
    if (project && project.path !== note.path) paths.add(project.path);
  }
  held = { notes, current, paths };
  return paths;
}

const tagCache = new WeakMap<readonly NoteMeta[], { tag: string; count: number }[]>();

/** Every tag in use, most used first, with how many notes carry it. */
export function tagCounts(notes: readonly NoteMeta[]): { tag: string; count: number }[] {
  let counts = tagCache.get(notes);
  if (!counts) {
    const byTag = new Map<string, number>();
    for (const n of notes) if (n.kind !== "template") for (const t of n.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);
    counts = [...byTag].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    tagCache.set(notes, counts);
  }
  return counts;
}

/** Journal days, projects and templates stay where they are. */
export const movable = (note: NoteMeta) => note.kind === "page" || note.kind === "card";
