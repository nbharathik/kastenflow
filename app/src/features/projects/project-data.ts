// What a project holds, for its home: its pages, cards and whiteboards,
// the newest first, and when anything in it last changed. Pure, from the
// window's lists of notes and boards.

import type { BoardInfo, DeckInfo, NoteMeta, TaskRow } from "../../lib/vault/types";
import { titleOf } from "../workspace/names";
import { childrenOf, projectNotes } from "../workspace/tree";

export interface ProjectParts {
  /** Pages and cards in the project, the project page left out, newest first. */
  recent: NoteMeta[];
  /** Every page, sub-pages too. */
  pages: NoteMeta[];
  /** The pages at the top of the project, by title, each with its number of sub-pages. */
  top: { note: NoteMeta; children: number }[];
  /** Cards and highlights, newest first. */
  cards: NoteMeta[];
  /** Whiteboards, newest first. */
  boards: BoardInfo[];
  /** Slide decks, newest first. */
  decks: DeckInfo[];
  /** When anything in it last changed, in milliseconds. */
  edited: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const newest = (a: { modified: number }, b: { modified: number }) => b.modified - a.modified;

export function partsOf(notes: readonly NoteMeta[], boards: readonly BoardInfo[], project: NoteMeta, decks: readonly DeckInfo[] = []): ProjectParts {
  const folder = project.project;
  const mine = folder ? notes.filter((n) => n.project === folder && n.path !== project.path && n.kind !== "template") : [];
  const pages = mine.filter((n) => n.kind === "page");
  const cards = mine.filter((n) => n.kind === "card" || n.kind === "highlight").sort(newest);
  const top = projectNotes(notes, project)
    .filter((n) => n.kind === "page")
    .sort((a, b) => collator.compare(titleOf(a), titleOf(b)))
    .map((note) => ({ note, children: childrenOf(notes, note).length }));
  const own = folder ? boards.filter((b) => b.project === folder).sort(newest) : [];
  const ownDecks = folder ? decks.filter((d) => d.project === folder).sort(newest) : [];
  const edited = Math.max(project.modified, ...mine.map((n) => n.modified), ...own.map((b) => b.modified), ...ownDecks.map((d) => d.modified));
  return { recent: [...mine].sort(newest), pages, top, cards, boards: own, decks: ownDecks, edited };
}

/** Whether a to-do lives in the project's folder. */
export const inFolder = (folder: string) => (row: TaskRow) => row.path.startsWith(`projects/${folder}/`);

/** Open and done to-dos among `rows`. */
export function todoCounts(rows: readonly TaskRow[]): { open: number; done: number } {
  let open = 0;
  for (const row of rows) if (!row.done) open++;
  return { open, done: rows.length - open };
}
