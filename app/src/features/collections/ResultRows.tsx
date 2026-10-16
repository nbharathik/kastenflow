// What a collection found, as a table, a list or a gallery. Reading only: a
// row is selected to preview and ticked to act on; nothing here edits a note.

import "../dashboard/dashboard.css";

import type { KeyboardEvent, MouseEvent } from "react";

import { relativeTime } from "../../lib/dates";
import type { NoteMeta, PropDef } from "../../lib/vault/types";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { NoteTile } from "../dashboard/NoteTiles";
import { BUILT_IN, valueOf } from "../tags/model";
import { shortValue, Values } from "../tags/views/ListView";
import { iconOf, titleOf } from "../workspace/names";

/** The columns a table shows unless the collection names some. */
export const DEFAULT_COLUMNS = ["title", "updated"] as const;

export interface RowsProps {
  notes: readonly NoteMeta[];
  /** Property keys and built-in fields, in order. */
  columns: readonly string[];
  defs: ReadonlyMap<string, PropDef>;
  /** The row the preview shows. */
  active: string | null;
  /** The rows ticked for an action. */
  checked: ReadonlySet<string>;
  onActivate(path: string): void;
  onOpen(path: string, event: MouseEvent | KeyboardEvent): void;
  /** Ticks or unticks a row; with Shift, the rows from the last one ticked. */
  onCheck(path: string, event: { shiftKey: boolean }): void;
}

const label = (key: string) => BUILT_IN[key] ?? key;

function cell(note: NoteMeta, key: string, defs: ReadonlyMap<string, PropDef>): string {
  if (key === "updated" || key === "created") {
    const value = valueOf(note, key);
    return typeof value === "string" && value ? value.slice(0, 10) : relativeTime(note.modified);
  }
  if (key === "modified") return relativeTime(note.modified);
  if (key === "project") return note.project ?? "";
  if (key === "type") return note.kind;
  return shortValue(valueOf(note, key), defs.get(key));
}

/** Arrow keys move the preview from row to row, Enter opens, Space ticks. */
function rowKeys(notes: readonly NoteMeta[], active: string | null, props: Pick<RowsProps, "onActivate" | "onOpen" | "onCheck">) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const at = notes.findIndex((n) => n.path === active);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = notes[Math.min(notes.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) props.onActivate(next.path);
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      props.onOpen(active, event);
    } else if (event.key === " " && active && event.target === event.currentTarget) {
      event.preventDefault();
      props.onCheck(active, event);
    }
  };
}

export function ResultTable(props: RowsProps) {
  const { notes, columns, defs, active, checked, onActivate, onOpen, onCheck } = props;
  const onKeyDown = rowKeys(notes, active, props);
  const shown = columns.length > 0 ? columns : DEFAULT_COLUMNS;
  return (
    <table className="w-full border-collapse text-14" aria-label="What the collection found" tabIndex={0} onKeyDown={onKeyDown} aria-rowcount={notes.length + 1}>
      <thead>
        <tr className="text-left text-12 text-muted">
          <th scope="col" className="w-8 px-2 py-1.5 font-medium">
            <span className="sr-only">Pick</span>
          </th>
          {shown.map((key) => (
            <th key={key} scope="col" className="px-2 py-1.5 font-medium">
              {label(key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {notes.map((note) => (
          <tr key={note.path} aria-selected={note.path === active} className={`border-t border-line ${note.path === active ? "bg-hover" : "hover:bg-hover/60"}`} onClick={() => onActivate(note.path)} onDoubleClick={(event) => onOpen(note.path, event)}>
            <td className="px-2 py-1.5">
              <input type="checkbox" checked={checked.has(note.path)} onChange={() => {}} onClick={(event) => onCheck(note.path, event)} aria-label={`Pick ${titleOf(note)}`} className="size-4 accent-[var(--color-accent)]" />
            </td>
            {shown.map((key) =>
              key === "title" ? (
                <td key={key} className="max-w-0 px-2 py-1.5">
                  <button type="button" onClick={(event) => (event.ctrlKey || event.metaKey || event.shiftKey ? onOpen(note.path, event) : onActivate(note.path))} className="flex min-w-0 items-center gap-2 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                    <IconOrEmoji icon={iconOf(note)} />
                    <span className="truncate">{titleOf(note)}</span>
                  </button>
                </td>
              ) : (
                <td key={key} className="max-w-[18rem] truncate px-2 py-1.5 text-muted">
                  {cell(note, key, defs)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResultList(props: RowsProps) {
  const { notes, columns, defs, active, checked, onActivate, onOpen, onCheck } = props;
  const onKeyDown = rowKeys(notes, active, props);
  const shown = columns.filter((key) => key !== "title" && defs.has(key)).slice(0, 3).map((key) => defs.get(key)!);
  return (
    <ul className="kasten-tag-list" aria-label="What the collection found" tabIndex={0} onKeyDown={onKeyDown}>
      {notes.map((note) => (
        <li key={note.path} aria-current={note.path === active}>
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={checked.has(note.path)} onChange={() => {}} onClick={(event) => onCheck(note.path, event)} aria-label={`Pick ${titleOf(note)}`} className="size-4 shrink-0 accent-[var(--color-accent)]" />
            <button type="button" className={`flex min-w-0 flex-1 items-center gap-2 text-left ${note.path === active ? "bg-hover" : ""}`} onClick={(event) => (event.ctrlKey || event.metaKey || event.shiftKey ? onOpen(note.path, event) : onActivate(note.path))} onDoubleClick={(event) => onOpen(note.path, event)}>
              <span aria-hidden="true" className="kasten-tag-icon">
                <IconOrEmoji icon={iconOf(note)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{titleOf(note)}</span>
                {note.excerpt && <span className="block truncate text-13 text-muted">{note.excerpt}</span>}
              </span>
              <Values note={note} defs={shown} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ResultGallery({ notes, columns, defs }: RowsProps) {
  const shown = columns.filter((key) => key !== "title" && defs.has(key)).slice(0, 3).map((key) => defs.get(key)!);
  return (
    <div className="kasten-tiles is-four" aria-label="What the collection found">
      {notes.map((note) => (
        <NoteTile key={note.path} note={note} peek detail={shown.length ? <Values note={note} defs={shown} /> : undefined} />
      ))}
    </div>
  );
}
