// Which rows of a table view are open with their sub-items. Remembered per
// view in this window's preferences, so a table comes back as it was left,
// and shared by the table and the view's menu (Expand all, Collapse all).

import { useCallback, useMemo } from "react";

import { usePrefs } from "../../../workspace/prefs";

/** What a view's open rows are kept under. */
export const openKey = (tag: string, viewName: string) => `${tag.toLowerCase()}|${viewName}`;

const NONE: string[] = [];

function store(key: string, ids: string[]): void {
  const { subItemsOpen, set } = usePrefs.getState();
  const next = { ...subItemsOpen };
  if (ids.length === 0) delete next[key];
  else next[key] = ids;
  set({ subItemsOpen: next });
}

/** Opens exactly these rows of the view. */
export const expandAll = (key: string, ids: readonly string[]) => store(key, [...ids]);

/** Shuts every row of the view. */
export const collapseAll = (key: string) => store(key, []);

export interface OpenRows {
  open: ReadonlySet<string>;
  /** Opens (`want` true), shuts (false) or flips a row, by its key. */
  set(id: string, want?: boolean): void;
}

export function useOpenRows(key: string): OpenRows {
  const list = usePrefs((s) => s.subItemsOpen[key] ?? NONE);
  const open = useMemo(() => new Set(list), [list]);
  const set = useCallback(
    (id: string, want?: boolean) => {
      const now = usePrefs.getState().subItemsOpen[key] ?? NONE;
      const has = now.includes(id);
      const open = want ?? !has;
      if (open === has) return;
      store(key, open ? [...now, id] : now.filter((x) => x !== id));
    },
    [key],
  );
  return useMemo(() => ({ open, set }), [open, set]);
}
