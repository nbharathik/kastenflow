// Putting a page's sub-pages in an order: one commit per move, with Undo in
// the notice. The order lives in the parent page (kasten-core's
// reorder_children); the sidebar and the page's own list both read it.

import type { NoteMeta } from "../../lib/vault/types";
import { titleOf } from "./names";
import { flushOpenPage, reloadOpenPage } from "./page/open-page";
import { useWorkspace } from "./store";
import { noteAt, treeOf } from "./tree";
import { movedIds, steppedIds } from "./tree-order";

/** The page `note` is a sub-page of and the sub-pages beside it in the order
 * shown (itself included), or null when it is not inside a page. */
export function siblingsOf(notes: readonly NoteMeta[], note: NoteMeta): { holder: NoteMeta; list: NoteMeta[] } | null {
  const index = treeOf(notes);
  const holder = note.parent ? index.byId.get(note.parent) : undefined;
  if (!holder || holder.kind !== "page" || holder.path === note.path) return null;
  const list = index.children.get(note.parent!) ?? [];
  return list.some((n) => n.path === note.path) ? { holder, list } : null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function store(holder: string, ids: string[]): Promise<NoteMeta | null> {
  const ws = useWorkspace.getState();
  if (!ws.client) return null;
  await flushOpenPage();
  try {
    const file = await ws.client.reorderChildren(holder, ids);
    useWorkspace.getState().noteChanged(file.meta);
    reloadOpenPage(holder);
    return file.meta;
  } catch (err) {
    ws.toast(message(err));
    return null;
  }
}

/** Stores `ids` as the order under `holder` and says so, with Undo back to the
 * order it had. */
async function reorder(holder: NoteMeta, ids: string[], text: string): Promise<boolean> {
  const before = holder.childrenOrder ?? [];
  if (!(await store(holder.path, ids))) return false;
  useWorkspace.getState().toast(text, { label: "Undo", run: () => void store(holder.path, before) });
  return true;
}

/** Moves the sub-page at `path` one place up (-1) or down (1) among its
 * siblings. Always says what happened, so there is no silent key press. */
export async function moveStep(path: string, step: -1 | 1): Promise<boolean> {
  const { notes, toast } = useWorkspace.getState();
  const note = noteAt(notes, path);
  const found = note ? siblingsOf(notes, note) : null;
  if (!note || !found) {
    toast("Only a page inside another page can be moved up or down.");
    return false;
  }
  const ids = note.id ? steppedIds(found.list, note.id, step) : null;
  if (!ids) {
    toast(found.list.length < 2 ? `It is the only page inside “${titleOf(found.holder)}”.` : `“${titleOf(note)}” is already ${step < 0 ? "first" : "last"}.`);
    return false;
  }
  return reorder(found.holder, ids, `Moved “${titleOf(note)}” ${step < 0 ? "up" : "down"}`);
}

/** Moves the sub-page at `path` before (or with `after`, behind) the sibling
 * at `target`. */
export async function moveBeside(path: string, target: string, after: boolean): Promise<boolean> {
  const { notes } = useWorkspace.getState();
  const note = noteAt(notes, path);
  const beside = noteAt(notes, target);
  const found = note ? siblingsOf(notes, note) : null;
  if (!note?.id || !beside?.id || !found) return false;
  const ids = movedIds(found.list, note.id, beside.id, after);
  if (!ids) return false;
  return reorder(found.holder, ids, `Moved “${titleOf(note)}” ${after ? "after" : "before"} “${titleOf(beside)}”`);
}
