// The pieces the sidebar's index is built (tree-index.ts) and patched
// (tree-patch.ts) from: sorting, lists that keep their identity, and the
// tree of folders outside Kasten's own.

import type { NoteMeta } from "../../lib/vault/types";
import type { FolderNode } from "./tree-types";

export const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const byTitle = (a: NoteMeta, b: NoteMeta) => collator.compare(a.title, b.title);
/** Shared and frozen: callers copy before sorting. */
export const EMPTY = Object.freeze([]) as unknown as NoteMeta[];

/** `next`, or `prev` when it holds the very same notes in the same order. */
export function share(prev: NoteMeta[] | undefined, next: NoteMeta[]): NoteMeta[] {
  if (next.length === 0) return EMPTY;
  if (!prev || prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return next;
  return prev;
}

export function shareMap(prev: Map<string, NoteMeta[]> | undefined, next: Map<string, NoteMeta[]>): Map<string, NoteMeta[]> {
  for (const [key, list] of next) next.set(key, share(prev?.get(key), list));
  return next;
}

export function replaced(list: NoteMeta[], old: NoteMeta, next: NoteMeta): NoteMeta[] {
  const at = list.indexOf(old);
  if (at < 0) return list;
  const copy = list.slice();
  copy[at] = next;
  return copy;
}

export function replacedIn(map: Map<string, NoteMeta[]>, key: string | null, old: NoteMeta, next: NoteMeta): Map<string, NoteMeta[]> {
  const list = key ? map.get(key) : undefined;
  if (!list || !list.includes(old)) return map;
  return new Map(map).set(key!, replaced(list, old, next));
}

/** Notes (in other folders) as the folders they sit in, each sorted. */
export function folderTree(notes: readonly NoteMeta[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], notes: [], count: 0 };
  const byPath = new Map<string, FolderNode>([["", root]]);
  const nodeFor = (dir: string): FolderNode => {
    let node = byPath.get(dir);
    if (node) return node;
    const at = dir.lastIndexOf("/");
    const parent = nodeFor(at < 0 ? "" : dir.slice(0, at));
    node = { name: dir.slice(at + 1), path: dir, folders: [], notes: [], count: 0 };
    parent.folders.push(node);
    byPath.set(dir, node);
    return node;
  };
  for (const note of notes) nodeFor(note.path.slice(0, note.path.lastIndexOf("/"))).notes.push(note);
  const finish = (node: FolderNode): number => {
    node.folders.sort((a, b) => collator.compare(a.name, b.name));
    node.notes.sort(byTitle);
    node.count = node.notes.length + node.folders.reduce((sum, folder) => sum + finish(folder), 0);
    return node.count;
  };
  finish(root);
  return root;
}

/** The tree with `old` swapped for `next`, which sits at the same path. */
export function withNote(node: FolderNode, old: NoteMeta, next: NoteMeta): FolderNode {
  if (node.notes.includes(old)) return { ...node, notes: replaced(node.notes, old, next) };
  const dir = old.path.slice(0, old.path.lastIndexOf("/"));
  const child = node.folders.find((f) => dir === f.path || dir.startsWith(`${f.path}/`));
  if (!child) return node;
  const swapped = withNote(child, old, next);
  return swapped === child ? node : { ...node, folders: node.folders.map((f) => (f === child ? swapped : f)) };
}
