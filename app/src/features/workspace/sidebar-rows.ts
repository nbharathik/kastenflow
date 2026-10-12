// What the sidebar lists under a row, and how a typed filter narrows the
// tree. Built on tree.ts's index: quick notes and captures stay out of the
// rows unless asked for, pinned pages come first, and the filter finds
// titles with their parents so the tree can open out around them.

import type { NoteMeta } from "../../lib/vault/types";
import { ancestors, loosePages, rowsUnder, treeOf } from "./tree";

/** Rows a list shows before "Show more": a project's sidebar stays short. */
export const FIRST_ROWS = 15;
/** Rows "Show more" adds. */
export const MORE_ROWS = 100;

interface Made {
  cards: boolean;
  pinned: readonly string[];
  rows: NoteMeta[];
}

const made = new WeakMap<NoteMeta[], Made>();

/** `rows` as the sidebar lists them: without cards (quick notes and
 * captures) unless `cards`, pinned pages first, each group in the order it
 * came. The same array while the rows, the setting and the pins hold, so
 * rows can skip redrawing. */
export function shownRows(rows: NoteMeta[], cards: boolean, pinned: readonly string[]): NoteMeta[] {
  if (rows.length === 0) return rows;
  const known = made.get(rows);
  if (known && known.cards === cards && known.pinned === pinned) return known.rows;
  let out = cards ? rows : rows.filter((n) => n.kind !== "card");
  if (pinned.length > 0 && out.length > 1) {
    const pins = new Set(pinned);
    const first = out.filter((n) => pins.has(n.path));
    if (first.length > 0 && first.length < out.length) out = [...first, ...out.filter((n) => !pins.has(n.path))];
  }
  if (out.length === rows.length && out.every((n, i) => n === rows[i])) out = rows;
  made.set(rows, { cards, pinned, rows: out });
  return out;
}

/** What nests under `note` in the sidebar: a project's pages and sub-pages
 * (its cards too when `cards`), or a page's sub-pages. */
export function sidebarRows(notes: readonly NoteMeta[], note: NoteMeta, cards: boolean, pinned: readonly string[]): NoteMeta[] {
  return shownRows(rowsUnder(notes, note), cards, pinned);
}

/** The pages outside projects, pinned ones first. */
export const sidebarLoose = (notes: readonly NoteMeta[], pinned: readonly string[]): NoteMeta[] => shownRows(loosePages(notes), true, pinned);

/** A whiteboard or deck the filter can match as well. */
export interface Named {
  path: string;
  title: string;
  project: string | null;
}

/** What a typed filter leaves of the tree. */
export interface TreeMatch {
  /** The lower-case text asked for. */
  query: string;
  /** Paths of rows to show: matches and what holds them. */
  show: ReadonlySet<string>;
  /** Paths of rows to open out: what holds a match. */
  open: ReadonlySet<string>;
}

const lowered = new WeakMap<readonly NoteMeta[], string[]>();

/** The rows whose title contains `query` (any case), with the rows that
 * hold them: parent pages and the project. Null for an empty filter. One
 * lower-casing of every title is kept per notes list, so each key pressed
 * is a plain scan of strings. */
export function matchTree(notes: readonly NoteMeta[], query: string, named: readonly Named[] = []): TreeMatch | null {
  const text = query.trim().toLowerCase();
  if (!text) return null;
  let titles = lowered.get(notes);
  if (!titles) {
    titles = notes.map((n) => n.title.toLowerCase());
    lowered.set(notes, titles);
  }
  const index = treeOf(notes);
  const show = new Set<string>();
  const open = new Set<string>();
  const holder = (path: string) => {
    show.add(path);
    open.add(path);
  };
  const projectOf = (folder: string | null | undefined) => (folder ? index.projectNote.get(folder) : undefined);
  for (let i = 0; i < notes.length; i++) {
    if (!titles[i]!.includes(text)) continue;
    const note = notes[i]!;
    if (note.kind === "template") continue;
    show.add(note.path);
    for (const parent of ancestors(notes, note)) holder(parent.path);
    const project = projectOf(note.project);
    if (project && project.path !== note.path) holder(project.path);
  }
  for (const item of named) {
    if (!item.title.toLowerCase().includes(text)) continue;
    show.add(item.path);
    const project = projectOf(item.project);
    if (project) holder(project.path);
  }
  return { query: text, show, open };
}
