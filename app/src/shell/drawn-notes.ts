// The notes as the sidebar draws them. A save that changes only the times,
// the counts, the excerpt or the property values leaves the sidebar as it is,
// so it takes the list through an equality check over what it draws.

import { useStoreWithEqualityFn } from "zustand/traditional";

import { useWorkspace } from "../features/workspace/store";
import type { NoteMeta } from "../lib/vault/types";

const FIELDS = ["path", "id", "title", "kind", "icon", "parent", "project", "locked"] as const;

const sameList = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined) => {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Whether two metas look the same in the sidebar: its rows, order and tag counts. */
export function sameDrawn(a: NoteMeta, b: NoteMeta): boolean {
  if (a === b) return true;
  for (const key of FIELDS) if (a[key] !== b[key]) return false;
  return sameList(a.childrenOrder, b.childrenOrder) && sameList(a.tags, b.tags);
}

/** Whether two lists draw the same sidebar. */
export function sameDrawnList(a: readonly NoteMeta[], b: readonly NoteMeta[]): boolean {
  return a === b || (a.length === b.length && a.every((n, i) => sameDrawn(n, b[i]!)));
}

/** The workspace's notes; the same array until something the sidebar draws changes. */
export function useDrawnNotes(): NoteMeta[] {
  return useStoreWithEqualityFn(useWorkspace, (s) => s.notes, sameDrawnList);
}
