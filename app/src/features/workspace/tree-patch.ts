// Patching the sidebar's index (tree-index.ts) when a few notes changed
// without moving.

import type { NoteMeta } from "../../lib/vault/types";
import { replaced, replacedIn, withNote } from "./tree-parts";
import { inOtherFolder, type TreeIndex } from "./tree-types";

/** More changed notes than this rebuild the index instead of patching it. */
const MAX_PATCH = 32;

/** Whether `next` sits where `old` did in every list (only text, icon or
 * dates changed), so the index can be patched instead of rebuilt. */
const sameShape = (old: NoteMeta, next: NoteMeta) =>
  old.path === next.path && old.title === next.title && old.parent === next.parent && old.project === next.project && old.kind === next.kind && old.id === next.id;

/** The previous index with a few notes swapped for their new versions. A
 * save while typing changes one note; this keeps that under a millisecond
 * where a rebuild sorts every list again. */
export function patch(prev: TreeIndex, before: readonly NoteMeta[], notes: readonly NoteMeta[]): TreeIndex | null {
  if (before.length !== notes.length) return null;
  const changed: [NoteMeta, NoteMeta][] = [];
  for (let i = 0; i < notes.length; i++) {
    if (before[i] === notes[i]) continue;
    if (changed.length === MAX_PATCH || !sameShape(before[i]!, notes[i]!)) return null;
    changed.push([before[i]!, notes[i]!]);
  }
  const index = { ...prev, byPath: new Map(prev.byPath) };
  let inboxMoved = false;
  for (const [old, next] of changed) {
    index.byPath.set(next.path, next);
    if (next.id && index.byId.get(next.id) === old) index.byId = new Map(index.byId).set(next.id, next);
    const lower = next.title.toLowerCase();
    if (index.titles.get(lower) === old) index.titles = new Map(index.titles).set(lower, next);
    if (next.project && index.projectNote.get(next.project) === old) index.projectNote = new Map(index.projectNote).set(next.project, next);
    index.children = replacedIn(index.children, next.parent, old, next);
    index.projectPages = replacedIn(index.projectPages, next.project, old, next);
    index.projects = replaced(index.projects, old, next);
    index.loose = replaced(index.loose, old, next);
    if (inOtherFolder(old.path)) index.folders = withNote(index.folders, old, next);
    index.journal = replaced(index.journal, old, next);
    index.templates = replaced(index.templates, old, next);
    index.openable = replaced(index.openable, old, next);
    const inbox = replaced(index.inbox, old, next);
    if (inbox !== index.inbox) {
      index.inbox = inbox;
      inboxMoved ||= old.modified !== next.modified;
    }
  }
  if (inboxMoved) index.inbox = index.inbox.slice().sort((a, b) => b.modified - a.modified);
  return index;
}
