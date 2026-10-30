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

import "./table/subitems.css";
import "./table/group.css";
import "./table/selection.css";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { NoteMeta, TagView } from "../../../lib/vault/types";
import { PointMenu } from "../../../shell/PointMenu";
import { useFrontActions } from "../in-front";
import { showsCalcs } from "./table/calc";
import { CalcFoot } from "./table/CalcFoot";
import { gridTemplate, tableColumns, widthOf, withWidth, type Column } from "./table/columns";
import { HEAD_HEIGHT, useLatest, type TableCtx } from "./table/context";
import { displayClasses, rowHeightOf } from "./table/display";
import { groupId, inheritedIds } from "./table/group";
import type { CellAt, Span } from "./table/grid";
import { GroupRow } from "./table/GroupRow";
import { Header } from "./table/Header";
import { canOrder } from "./table/manual-order";
import { NewRow, useFresh } from "./table/NewRow";
import { ORDER_TYPE, RowToolsContext, type RowTools } from "./table/row-tools";
import { groupState, type GroupState } from "./table/rows-select";
import { cellId, Row } from "./table/Row";
import { SelectionBar } from "./table/SelectionBar";
import type { FlatRow } from "./table/subitems";
import { useGrid, type Editing } from "./table/useGrid";
import { useGroups, type Grouped, type Item } from "./table/useGroups";
import { useManualOrder } from "./table/useManualOrder";
import { usePaste } from "./table/usePaste";
import { useSelection } from "./table/useSelection";
import { useSubTable } from "./table/useSubTable";
import { COLS_VAR, useResize } from "./table/useResize";
import { useScrollEdges, useScrollMemory, useWindow } from "./table/useWindow";
import type { ViewProps } from "./types";
import { Icon } from "../../../ui/Icon";

export function TableView(props: ViewProps) {
  // Another view of the tag is another table: its own active cell and place.
  return <Table key={props.view.name} {...props} />;
}

function Table({ tag, schema, view, notes: listed, pool, onChange, add, label }: ViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const columns = useMemo(() => tableColumns(view, schema), [view, schema]);
  const widths = useMemo(() => columns.map((c) => widthOf(view, c)), [columns, view]);
  // With sub-items the rows are the visible ones of a tree; else the notes as given.
  const sub = useSubTable(tag, view, listed, pool);
  // Grouped, the rows come group by group with a header row before each.
  const grouped = useGroups(tag, view, schema, columns, listed, pool, sub);
  const notes = grouped ? grouped.rows : sub.rows;
  const meta = grouped ? grouped.meta : sub.meta;
  const items = grouped ? grouped.items : null;
  const itemCount = items ? items.length : notes.length;
  const calcs = showsCalcs(view);
  const rowHeight = rowHeightOf(view);
  useScrollMemory(scroller, `${tag.toLowerCase()}|${view.name}`);
  const span = useWindow(scroller, itemCount, rowHeight);
  const itemOf = grouped ? grouped.itemOf : null;
  const layout = useMemo(() => ({ rowHeight, itemOf, footHeight: calcs ? HEAD_HEIGHT : 0 }), [rowHeight, itemOf, calcs]);
  const grid = useGrid(scroller, foot, notes, columns, widths, layout);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const openMenu = useCallback((x: number, y: number) => setMenuAt({ x, y }), []);
  useLayoutEffect(() => {
    const ctx = grid.ctx;
    ctx.sub.current = sub.api;
    return () => {
      if (ctx.sub.current === sub.api) ctx.sub.current = null;
    };
  }, [grid.ctx, sub.api]);
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
    const pos = itemOf?.[row] ?? row;
    if (pos < span.start || pos >= span.end) stopEditing();
  }, [editing, notes, itemOf, span, stopEditing]);

  const [fresh, markFresh] = useFresh(notes, grid.reveal);

  const at = grid.at;
  const atPos = at ? (itemOf?.[at.row] ?? at.row) : -1;
  const drawn = at && atPos >= span.start && atPos < span.end ? at : null;

  // Picked rows (a checkbox, Shift ranges, Space, Shift+arrows) and the bar that acts on them.
  // A parent greyed because only a sub-item of it matches is not taken by "Select all" or a group's checkbox.
  const matching = useMemo(() => (sub.meta ? sub.rows.filter((_, i) => !sub.meta![i]?.dim) : sub.rows), [sub.rows, sub.meta]);
  const selection = useSelection(sub.rows, notes, matching);
  const groupSpec = grouped?.spec ?? null;
  const groupPaths = useMemo(() => {
    if (!groupSpec) return null;
    const ids = sub.meta ? inheritedIds(sub.meta, groupSpec) : sub.rows.map((n) => groupId(n, groupSpec));
    const out = new Map<string | null, string[]>();
    sub.rows.forEach((n, i) => {
      if (sub.meta?.[i]?.dim) return;
      const id = ids[i] ?? null;
      const list = out.get(id);
      if (list) list.push(n.path);
      else out.set(id, [n.path]);
    });
    return out;
  }, [groupSpec, sub.rows, sub.meta]);
  const groupLatest = useLatest(groupPaths);
  const pickGroup = useCallback((id: string | null) => selection.api.group(groupLatest.current?.get(id) ?? []), [selection.api, groupLatest]);
  const pickedOf = useCallback((id: string | null): GroupState => (selection.picked.paths.size === 0 ? "none" : groupState(selection.picked, groupPaths?.get(id) ?? [])), [selection.picked, groupPaths]);

  // With no sort, rows go in order by hand: a drag by the grip, or Alt+↑/↓ on the active row.
  const ordering = canOrder(view, { grouped: grouped !== null, subItems: view.sub_items === true, custom: add !== undefined });
  const order = useManualOrder(tag, view, schema, notes);
  const open = grid.ctx.open;
  const tools = useMemo<RowTools>(
    () => ({
      pick: selection.api.pick,
      ordering,
      startDrag(event, note) {
        event.dataTransfer.setData(ORDER_TYPE, note.path);
        event.dataTransfer.effectAllowed = "move";
      },
      dropRow: order.dropRow,
      openSide: (path) => open(path, "peek-side"),
    }),
    [selection.api, ordering, order.dropRow, open],
  );
  // The palette's way to the same actions (see tags/commands.ts).
  const activeNote = at ? notes[at.row] : undefined;
  useFrontActions("table", scroller, {
    selectAll: selection.api.selectAll,
    selectGroup: grouped && at && grouped.groupOf[at.row] !== undefined ? () => pickGroup(grouped.groupOf[at.row]!) : undefined,
    moveRow: ordering && activeNote ? (delta) => order.move(activeNote, delta) : undefined,
  });
  // A block copied from a spreadsheet pastes at the active cell.
  const onPaste = usePaste({ tag, view, schema, columns, rows: notes, at, editing: editing !== null, add });

  // Ctrl+Shift+↑ shuts the active row's group, Ctrl+Shift+↓ opens every group.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const fold = grouped && event.target === event.currentTarget && (event.ctrlKey || event.metaKey) && event.shiftKey;
    if (fold && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      if (event.key === "ArrowDown") grouped.setAll(false);
      else if (at && grouped.groupOf[at.row] !== undefined) grouped.fold(grouped.groupOf[at.row]!, true);
      return;
    }
    // Ctrl+Shift+Space picks (or lets go of) every row of the active row's group.
    if (fold && event.key === " " && at && grouped.groupOf[at.row] !== undefined) {
      event.preventDefault();
      pickGroup(grouped.groupOf[at.row]!);
      return;
    }
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    const note = at && vertical && event.target === event.currentTarget && !editing && !event.ctrlKey && !event.metaKey ? notes[at.row] : undefined;
    if (note && event.shiftKey && !event.altKey) selection.api.extend(note.path, event.key === "ArrowDown" ? 1 : -1);
    else if (note && event.altKey && !event.shiftKey && ordering) {
      // Alt+↑/↓ moves the row one place; the active cell goes with it.
      event.preventDefault();
      order.move(note, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    grid.onKeyDown(event);
  };
  return (
    <RowToolsContext.Provider value={tools}>
      <div className={`kasten-table${displayClasses(view)}${selection.picked.paths.size > 0 ? " has-picks" : ""}`} style={{ "--row-h": `${rowHeight}px` } as CSSProperties}>
        <p id={`${idBase}-keys`} className="sr-only">
          Arrow keys and Tab move between cells, Enter edits one, and Escape, then Tab, leaves the table. Space picks the row; Shift with the arrows picks several.
          {ordering && " Alt with the up or down arrow moves the row."}
          {grouped && " Control and Shift with the up arrow fold the row’s group; with the down arrow they open every group. Control and Shift with Space pick every row of the group."}
        </p>
        <div
          ref={scroller}
          role="grid"
          aria-label={label ?? `Notes tagged #${tag}`}
          aria-rowcount={itemCount + 1 + (calcs ? 1 : 0)}
          aria-colcount={columns.length}
          aria-describedby={`${idBase}-keys`}
          aria-activedescendant={drawn ? cellId(idBase, drawn.row, drawn.col) : undefined}
          tabIndex={0}
          className="kasten-table-scroll"
          style={{ [COLS_VAR]: gridTemplate(widths) } as CSSProperties}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={grid.onFocus}
        >
          <Header columns={columns} widths={widths} view={view} schema={schema} change={change} resize={resize} />
          {itemCount === 0 ? (
            <Empty filtered={(view.filter?.length ?? 0) > 0} custom={label !== undefined} />
          ) : (
            <Body
              notes={notes}
              meta={meta}
              items={items}
              grouped={grouped}
              openMenu={openMenu}
              count={itemCount}
              rowHeight={rowHeight}
              span={span}
              columns={columns}
              at={at}
              editing={editing}
              fresh={fresh}
              ctx={grid.ctx}
              idBase={idBase}
              picked={selection.picked.paths}
              stateOf={pickedOf}
              pickGroup={pickGroup}
            />
          )}
          {calcs && <CalcFoot columns={columns} view={view} notes={listed} pos={itemCount} change={change} />}
        </div>
        <NewRow footRef={foot} tag={tag} view={view} schema={schema} count={sub.count} onAdded={markFresh} add={add} label={label} under={sub.under} onUnderDone={sub.clearUnder} />
        {sub.menu}
        {menuAt && grouped && (
          <PointMenu
            x={menuAt.x}
            y={menuAt.y}
            label="Options for the groups"
            onClose={() => setMenuAt(null)}
            items={[
              { label: "Collapse all groups", hint: "Ctrl+Shift+↑", onSelect: () => grouped.setAll(true) },
              { label: "Expand all groups", hint: "Ctrl+Shift+↓", onSelect: () => grouped.setAll(false) },
            ]}
          />
        )}
      </div>
      {selection.chosen.length > 0 && (
        <SelectionBar
          rows={selection.chosen}
          shown={matching.length}
          properties={schema?.properties ?? []}
          onSelectAll={selection.api.selectAll}
          onClear={selection.api.clear}
          onKeepFirst={selection.api.keepFirst}
        />
      )}
    </RowToolsContext.Provider>
  );
}

interface BodyProps {
  notes: readonly NoteMeta[];
  /** Each row's depth, fold and greying, in step with `notes`; null without sub-items. */
  meta: readonly FlatRow[] | null;
  /** Rows and group headers in the order drawn, when the table is grouped. */
  items: readonly Item[] | null;
  grouped: Grouped | null;
  openMenu(x: number, y: number): void;
  /** How many places there are to draw: rows and group headers. */
  count: number;
  rowHeight: number;
  span: Span;
  columns: Column[];
  at: CellAt | null;
  editing: Editing | null;
  fresh: string | null;
  ctx: TableCtx;
  idBase: string;
  /** The paths of the picked rows. */
  picked: ReadonlySet<string>;
  /** How much of a group is picked, and its checkbox. */
  stateOf(id: string | null): GroupState;
  pickGroup(id: string | null): void;
}

/** The rows in view, between spacers as tall as the rows not drawn. */
function Body({ notes, meta, items, grouped, openMenu, count, rowHeight, span, columns, at, editing, fresh, ctx, idBase, picked, stateOf, pickGroup }: BodyProps) {
  const start = Math.min(span.start, count);
  const end = Math.min(span.end, count);
  const rows = [];
  for (let pos = start; pos < end; pos++) {
    const item = items ? items[pos]! : pos;
    if (typeof item !== "number") {
      rows.push(
        <GroupRow key={`g:${item.id === null ? "" : `v:${item.id}`}`} head={item} columns={columns} pos={pos} toggle={grouped!.toggle} menu={openMenu} picked={stateOf(item.id)} pick={pickGroup} />,
      );
      continue;
    }
    const row = item;
    const note = notes[row]!;
    const mine = editing?.path === note.path ? editing : null;
    const place = meta?.[row];
    rows.push(
      <Row
        key={note.path}
        note={note}
        depth={place?.depth ?? 0}
        fold={place?.fold ?? "none"}
        dim={place?.dim ?? false}
        row={row}
        pos={pos}
        columns={columns}
        activeCol={at?.row === row ? at.col : -1}
        editingKey={mine?.key ?? null}
        seed={mine?.seed ?? null}
        fresh={note.path === fresh}
        ctx={ctx}
        idBase={idBase}
        selected={picked.has(note.path)}
      />,
    );
  }
  return (
    <div role="rowgroup" className="kasten-table-body" style={{ paddingTop: start * rowHeight, paddingBottom: (count - end) * rowHeight }}>
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
