// One of the project's saved tables: its name, the filters and sort as chips,
// and the rows in the tag database's table (columns, sorting, resizing and
// opening notes all work as they do there). Every change is saved with the
// table in the project page's `overview` property.

import "../../tags/tags.css";

import { useMemo, useRef, useState } from "react";

import type { NoteMeta, TagView } from "../../../lib/vault/types";
import { IconButton } from "../../../ui/Button";
import { findInView } from "../../tags/model";
import { TableView } from "../../tags/views/TableView";
import { ViewBar } from "../../tags/ViewBar";
import { makeProjectPage } from "./overview-actions";
import { tableNotes } from "./overview";

interface Props {
  table: TagView;
  folder: string;
  /** The project's title, for the table's name to screen readers. */
  projectTitle: string;
  notes: readonly NoteMeta[];
  onChange(next: TagView): void;
  onDuplicate(): void;
  onDelete(): void;
}

export function TableTab({ table, folder, projectTitle, notes, onChange, onDuplicate, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const covered = useMemo(() => tableNotes(notes, table, folder), [notes, table, folder]);
  const shown = useMemo(() => findInView(covered, query), [covered, query]);
  const add = useMemo(() => (title: string) => makeProjectPage(folder, title), [folder]);
  const total = useMemo(() => tableNotes(notes, { ...table, filter: [] }, folder).length, [notes, table, folder]);

  const rename = (name: string | null) => {
    setRenaming(false);
    if (name && name !== table.name) onChange({ ...table, name });
  };

  return (
    <div className="kasten-tagdb">
      <header className="kasten-overview-table-head">
        {renaming ? <Rename name={table.name} onDone={rename} /> : <h2 className="text-16 font-semibold">{table.name}</h2>}
        <span className="text-13 text-muted">
          {table.scope === "vault" ? "Every page in the vault" : `Pages and cards of ${projectTitle}`}
        </span>
        <span className="flex-1" />
        <IconButton icon="edit" label={`Rename ${table.name}`} size="sm" onClick={() => setRenaming(true)} />
        <IconButton icon="copy" label={`Duplicate ${table.name}`} size="sm" onClick={onDuplicate} />
        <IconButton icon="trash" label={`Delete the table ${table.name}`} size="sm" onClick={onDelete} />
      </header>
      <ViewBar view={table} schema={null} shown={shown.length} total={total} onChange={onChange} find={{ query, onQuery: setQuery }} />
      <div className="kasten-tagdb-body">
        <TableView tag={`${folder}/${table.name}`} schema={null} view={table} notes={shown} onChange={onChange} add={add} label={`${table.name} in ${projectTitle}`} />
      </div>
    </div>
  );
}

/** The table's name as a field: Enter keeps it, Escape or leaving it keeps the old name. */
function Rename({ name, onDone }: { name: string; onDone(name: string | null): void }) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={field}
      autoFocus
      defaultValue={name}
      aria-label="Table name"
      maxLength={60}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(e.currentTarget.value.trim() || null);
        else if (e.key === "Escape") {
          e.stopPropagation();
          onDone(null);
        }
      }}
      className="h-8 w-56 rounded-lg border border-line bg-raised px-2 text-14 outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    />
  );
}
