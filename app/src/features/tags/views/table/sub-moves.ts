// Making and moving sub-items from the table: indent and outdent a row (Tab
// and Shift+Tab on its title), a drop on another row, and a new sub-item.
// Every change is a core op: nesting is one commit with Undo in its notice
// (workspace/placing.ts), a new sub-item is one commit that makes the note.

import type { NoteFile, NoteMeta } from "../../../../lib/vault/types";
import { nestable, nestNote } from "../../../workspace/placing";
import { titleOf } from "../../../workspace/names";
import { isWithin, treeOf } from "../../../workspace/tree";
import { useWorkspace } from "../../../workspace/store";
import { addNote } from "../../actions";
import type { FlatRow } from "./subitems";

/** The row a row goes under when indented: the one just above it at its own level. */
export function indentUnder(rows: readonly FlatRow[], index: number): NoteMeta | null {
  const depth = rows[index]?.depth;
  if (depth === undefined) return null;
  for (let i = index - 1; i >= 0; i--) {
    const at = rows[i]!.depth;
    if (at === depth) return rows[i]!.note;
    if (at < depth) return null;
  }
  return null;
}

/** The row a row is inside, or null for a top-level row. */
export function parentRow(rows: readonly FlatRow[], index: number): NoteMeta | null {
  const depth = rows[index]?.depth ?? 0;
  if (depth === 0) return null;
  for (let i = index - 1; i >= 0; i--) if (rows[i]!.depth === depth - 1) return rows[i]!.note;
  return null;
}

const toast = (text: string) => useWorkspace.getState().toast(text);

/** Puts the row at `index` inside the row above it. Returns the row it went into. */
export async function indentRow(rows: readonly FlatRow[], index: number): Promise<NoteMeta | null> {
  const note = rows[index]?.note;
  if (!note) return null;
  const into = indentUnder(rows, index);
  if (!into) {
    toast("There is no row above it at its level to go under.");
    return null;
  }
  if (into.kind !== "page") {
    toast(`“${titleOf(into)}” cannot hold sub-items; only pages can.`);
    return null;
  }
  const notes = useWorkspace.getState().notes;
  if (nestable(notes, [note.path], into).length === 0) {
    toast(isWithin(notes, into.path, note) ? "A page cannot go inside itself or its own sub-page." : `“${titleOf(note)}” is already inside “${titleOf(into)}”.`);
    return null;
  }
  return (await nestNote(note.path, into.path)) ? into : null;
}

/** Takes the row at `index` out of the row it is inside, to the level above. */
export async function outdentRow(rows: readonly FlatRow[], index: number): Promise<boolean> {
  const note = rows[index]?.note;
  const inside = parentRow(rows, index);
  if (!note) return false;
  if (!inside) {
    toast("It is already at the top level.");
    return false;
  }
  const notes = useWorkspace.getState().notes;
  const holder = inside.parent ? treeOf(notes).byId.get(inside.parent) : undefined;
  return (await nestNote(note.path, holder && holder.path !== inside.path ? holder.path : null)) !== null;
}

/** Makes a note titled `title` carrying `tag`, a sub-page of `under`, in one commit. */
export async function addSubItem(tag: string, under: NoteMeta, title: string, props: Record<string, unknown>, add?: (title: string) => Promise<NoteMeta | null>): Promise<string | null> {
  if (add) {
    // A table that is not one tag's makes its notes its own way; the nest follows as a second step.
    const made = await add(title);
    if (!made) return null;
    const placed = await nestNote(made.path, under.path, false);
    return placed?.meta.path ?? made.path;
  }
  const note: NoteFile | null = await addNote(tag, title, props, { project: under.project, parent: under.path });
  return note?.meta.path ?? null;
}
