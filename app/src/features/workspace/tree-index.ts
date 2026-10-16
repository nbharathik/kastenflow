// The sidebar's index: one per notes array, built once and cached. Lists
// that did not change keep their identity from the previous index, so rows
// can skip re-rendering when one note is saved.

import type { NoteMeta } from "../../lib/vault/types";
import { HOLDS_PAGES } from "./page/new-page-home";
import { byTitle, folderTree, share, shareMap } from "./tree-parts";
import { patch } from "./tree-patch";
import { inOtherFolder, type TreeIndex } from "./tree-types";

const cache = new WeakMap<readonly NoteMeta[], TreeIndex>();
let last: TreeIndex | null = null;
let lastNotes: readonly NoteMeta[] | null = null;

/** A fresh index (exported for tests; callers use `treeOf`). */
export function build(notes: readonly NoteMeta[]): TreeIndex {
  const byPath = new Map<string, NoteMeta>();
  const byId = new Map<string, NoteMeta>();
  const titles = new Map<string, NoteMeta>();
  const children = new Map<string, NoteMeta[]>();
  const grouped = new Map<string, NoteMeta[]>();
  const projectNote = new Map<string, NoteMeta>();
  const projectList: NoteMeta[] = [];
  const looseAll: NoteMeta[] = [];
  const elsewhere: NoteMeta[] = [];
  const inbox: NoteMeta[] = [];
  const journal: NoteMeta[] = [];
  const templateList: NoteMeta[] = [];
  const openableList: NoteMeta[] = [];

  for (const n of notes) {
    byPath.set(n.path, n);
    if (n.id && !byId.has(n.id)) byId.set(n.id, n);
  }
  for (const n of notes) {
    if (n.kind === "template") {
      if (n.path.startsWith("templates/")) templateList.push(n);
      continue;
    }
    openableList.push(n);
    const lower = n.title.toLowerCase();
    if (!titles.has(lower)) titles.set(lower, n);
    // Only pages and projects hold sub-pages; a page under anything else (a
    // journal day, a card) shows on its own (page/new-page-home.ts).
    const parent = n.parent ? byId.get(n.parent) : undefined;
    const held = parent !== undefined && parent.path !== n.path && HOLDS_PAGES.has(parent.kind);
    if (held) {
      const list = children.get(n.parent!);
      if (list) list.push(n);
      else children.set(n.parent!, [n]);
    }
    if (n.kind === "project") {
      projectList.push(n);
      if (n.project && !projectNote.has(n.project)) projectNote.set(n.project, n);
    }
    if (n.kind === "journal") journal.push(n);
    if (n.path.startsWith("inbox/")) inbox.push(n);
    // Top level: no parent, or one that is not in the vault or holds no pages.
    const top = !held;
    if (top && (n.kind === "page" || n.kind === "card") && n.project) {
      const list = grouped.get(n.project);
      if (list) list.push(n);
      else grouped.set(n.project, [n]);
    }
    if (top && inOtherFolder(n.path)) elsewhere.push(n);
    else if (top && n.kind === "page" && !n.project && !n.path.startsWith("inbox/")) looseAll.push(n);
  }
  for (const list of children.values()) list.sort(byTitle);
  const projectPages = new Map<string, NoteMeta[]>();
  for (const [project, list] of grouped) {
    const own = list.filter((n) => n.path !== projectNote.get(project)?.path).sort(byTitle);
    projectPages.set(project, [...own.filter((n) => n.kind === "page"), ...own.filter((n) => n.kind === "card")]);
  }

  const prev = last;
  return {
    byPath,
    byId,
    titles,
    children: shareMap(prev?.children, children),
    projectPages: shareMap(prev?.projectPages, projectPages),
    projectNote,
    projects: share(prev?.projects, projectList.sort(byTitle)),
    loose: share(prev?.loose, looseAll.sort(byTitle)),
    folders: elsewhere.length === 0 && prev?.folders.count === 0 ? prev.folders : folderTree(elsewhere),
    inbox: share(prev?.inbox, inbox.sort((a, b) => b.modified - a.modified)),
    journal: share(prev?.journal, journal.sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0))),
    templates: share(prev?.templates, templateList),
    openable: share(prev?.openable, openableList),
  };
}

/** The index for this notes array, built on first use. */
export function treeOf(notes: readonly NoteMeta[]): TreeIndex {
  let index = cache.get(notes);
  if (!index) {
    index = (last && lastNotes && patch(last, lastNotes, notes)) || build(notes);
    cache.set(notes, index);
    last = index;
    lastNotes = notes;
  }
  return index;
}
