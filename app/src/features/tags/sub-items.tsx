// Sub-items outside the table: a note whose `parent` is another note of the
// same database is a sub-item of it. The table shows them as a tree; the
// board, list, gallery and timeline show each as it is with a small "↳ Parent"
// chip, and a switch on the view can leave them out ("Hide sub-items").

import "./sub-items.css";

import { createContext, useContext, useMemo } from "react";

import type { NoteMeta, TagSchema, TagView } from "../../lib/vault/types";
import { titleOf } from "../workspace/names";
import { applyView } from "./model";
import { openKey } from "./views/table/open-rows";
import { parentsOf } from "./views/table/subitems";

/** The titles of the notes that have sub-items in this database, by id. */
const ParentTitles = createContext<ReadonlyMap<string, string> | null>(null);
export const ParentTitlesProvider = ParentTitles.Provider;

/** The title of the database note `note` is a sub-item of, if it is one. */
export function useParentTitle(note: NoteMeta): string | null {
  const titles = useContext(ParentTitles);
  return (note.parent && titles?.get(note.parent)) || null;
}

/** "↳ Parent": a small chip saying which note this one is a sub-item of. */
export function ParentChip({ note }: { note: NoteMeta }) {
  const parent = useParentTitle(note);
  if (!parent) return null;
  return (
    <span className="kasten-parent-chip" title={`A sub-item of ${parent}`}>
      <span aria-hidden="true">↳ </span>
      <span className="sr-only">Sub-item of </span>
      {parent}
    </span>
  );
}

/** What a database's views need to show sub-items. */
export interface SubItems {
  /** The tag's notes in the view's order, filters aside (a table with sub-items finds parents here). */
  pool: readonly NoteMeta[] | undefined;
  /** What the view body is given: `listed`, less the sub-items when the view hides them. */
  notes: NoteMeta[];
  /** Titles for the "↳ Parent" chips, null where the view has none. */
  chips: ReadonlyMap<string, string> | null;
  /** What the view menu needs for the table's Expand all and Collapse all. */
  menu: { openKey: string; parents: string[] } | null;
}

export function useSubItems(tag: string, view: TagView, schema: TagSchema | null, tagged: readonly NoteMeta[], listed: NoteMeta[]): SubItems {
  const table = view.type === "table";
  const inTree = table && view.sub_items === true;
  const chipped = !table && view.type !== "calendar";
  const pool = useMemo(() => (inTree ? applyView(tagged, { ...view, filter: [] }, schema) : undefined), [inTree, tagged, view, schema]);
  const parents = useMemo(() => (inTree ? parentsOf(tagged) : []), [inTree, tagged]);
  const titles = useMemo(() => {
    if (!chipped) return null;
    const byId = new Map<string, NoteMeta>();
    for (const n of tagged) if (n.id) byId.set(n.id, n);
    const out = new Map<string, string>();
    for (const n of tagged) {
      const parent = n.parent ? byId.get(n.parent) : undefined;
      if (parent && parent.path !== n.path) out.set(parent.id!, titleOf(parent));
    }
    return out;
  }, [chipped, tagged]);
  const notes = useMemo(() => (chipped && view.hide_sub_items === true && titles && titles.size > 0 ? listed.filter((n) => !(n.parent && titles.has(n.parent) && n.parent !== n.id)) : listed), [chipped, view.hide_sub_items, titles, listed]);
  return { pool, notes, chips: titles && titles.size > 0 ? titles : null, menu: inTree ? { openKey: openKey(tag, view.name), parents } : null };
}
