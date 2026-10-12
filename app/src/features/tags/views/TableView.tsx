// The table view: cells edit inline, and a new row is a new note carrying
// the tag. The title
// column sticks to the left, the header to the top; each cell edits in
// place by its property's type; columns sort, hide, move and resize, all
// saved with the view in the tag's YAML. Rows are windowed and memoised,
// so thousands of notes scroll and edit smoothly.

import "../../pages/editor/styles/tokens.css";
import "./table/table.css";
import "./table/cells.css";
import "./table/popups.css";

import { useCallback, useEffect, useId, useMemo, useRef, type CSSProperties } from "react";

import type { NoteMeta, TagView } from "../../../lib/vault/types";
import { gridTemplate, tableColumns, widthOf, withWidth, type Column } from "./table/columns";
import { ROW_HEIGHT, useLatest, type TableCtx } from "./table/context";
import type { CellAt, Span } from "./table/grid";
import { Header } from "./table/Header";
import { NewRow, useFresh } from "./table/NewRow";
import { cellId, Row } from "./table/Row";
import { useGrid, type Editing } from "./table/useGrid";
import { COLS_VAR, useResize } from "./table/useResize";
import { useScrollEdges, useScrollMemory, useWindow } from "./table/useWindow";
import type { ViewProps } from "./types";
import { Icon } from "../../../ui/Icon";

export function TableView(props: ViewProps) {
  // Another view of the tag is another table: its own active cell and place.
  return <Table key={props.view.name} {...props} />;
}

function Table({ tag, schema, view, notes, onChange, add, label }: ViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const columns = useMemo(() => tableColumns(view, schema), [view, schema]);
  const widths = useMemo(() => columns.map((c) => widthOf(view, c)), [columns, view]);
  useScrollMemory(scroller, `${tag.toLowerCase()}|${view.name}`);
  const span = useWindow(scroller, notes.length);
  const grid = useGrid(scroller, foot, notes, columns, widths);
  useScrollEdges(scroller);

  // Stable for the memoised header: the view saved is always the latest.
  const latest = useLatest({ view, onChange });
  const change = useCallback((next: TagView) => latest.current.onChange(next), [latest]);
  const saveWidth = useCallback(
    (column: Column, width: number) => {
      const { view, onChange } = latest.current;
      const next = withWidth(view, column, width);
      if (next !== view) onChange(next);
    },
    [latest],
  );
  const resize = useResize(scroller, columns, widths, saveWidth);

  // An editor whose row scrolled out of view (or left the view) closes.
  const { editing, stopEditing } = grid;
  useEffect(() => {
    if (!editing) return;
    const row = notes.findIndex((n) => n.path === editing.path);
    if (row < span.start || row >= span.end) stopEditing();
  }, [editing, notes, span, stopEditing]);

  const [fresh, markFresh] = useFresh(notes, grid.reveal);

  const at = grid.at;
  const drawn = at && at.row >= span.start && at.row < span.end ? at : null;
  return (
    <div className="kasten-table">
      <p id={`${idBase}-keys`} className="sr-only">
        Arrow keys and Tab move between cells, Enter edits one, and Escape, then Tab, leaves the table.
      </p>
      <div
        ref={scroller}
        role="grid"
        aria-label={label ?? `Notes tagged #${tag}`}
        aria-rowcount={notes.length + 1}
        aria-colcount={columns.length}
        aria-describedby={`${idBase}-keys`}
        aria-activedescendant={drawn ? cellId(idBase, drawn.row, drawn.col) : undefined}
        tabIndex={0}
        className="kasten-table-scroll"
        style={{ [COLS_VAR]: gridTemplate(widths) } as CSSProperties}
        onKeyDown={grid.onKeyDown}
        onFocus={grid.onFocus}
      >
        <Header columns={columns} widths={widths} view={view} schema={schema} change={change} resize={resize} />
        {notes.length === 0 ? (
          <Empty filtered={(view.filter?.length ?? 0) > 0} custom={label !== undefined} />
        ) : (
          <Body notes={notes} span={span} columns={columns} at={at} editing={editing} fresh={fresh} ctx={grid.ctx} idBase={idBase} />
        )}
      </div>
      <NewRow footRef={foot} tag={tag} view={view} schema={schema} count={notes.length} onAdded={markFresh} add={add} label={label} />
    </div>
  );
}

interface BodyProps {
  notes: readonly NoteMeta[];
  span: Span;
  columns: Column[];
  at: CellAt | null;
  editing: Editing | null;
  fresh: string | null;
  ctx: TableCtx;
  idBase: string;
}

/** The rows in view, between spacers as tall as the rows not drawn. */
function Body({ notes, span, columns, at, editing, fresh, ctx, idBase }: BodyProps) {
  const start = Math.min(span.start, notes.length);
  const end = Math.min(span.end, notes.length);
  const rows = [];
  for (let row = start; row < end; row++) {
    const note = notes[row]!;
    const mine = editing?.path === note.path ? editing : null;
    rows.push(
      <Row
        key={note.path}
        note={note}
        row={row}
        columns={columns}
        activeCol={at?.row === row ? at.col : -1}
        editingKey={mine?.key ?? null}
        seed={mine?.seed ?? null}
        fresh={note.path === fresh}
        ctx={ctx}
        idBase={idBase}
      />,
    );
  }
  return (
    <div role="rowgroup" className="kasten-table-body" style={{ paddingTop: start * ROW_HEIGHT, paddingBottom: (notes.length - end) * ROW_HEIGHT }}>
      {rows}
    </div>
  );
}

/** `custom`: a table that is not one tag's (a project's saved table), so no tag is to blame. */
function Empty({ filtered, custom }: { filtered: boolean; custom: boolean }) {
  return (
    <div role="row" className="kasten-table-empty-row">
      <div role="gridcell" className="kasten-table-empty">
        <span aria-hidden="true" className="kasten-table-empty-icon">
          <Icon name="table" className="size-5" />
        </span>
        {filtered ? "No notes match this view’s filters." : custom ? "Nothing in this table yet. Add the first page with New below." : "No notes carry this tag yet. Add the first with New below."}
      </div>
    </div>
  );
}
