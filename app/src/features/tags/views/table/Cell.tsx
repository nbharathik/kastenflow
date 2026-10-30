// One cell of the table: the title (opens the note), a built-in field
// (read-only) or a property, shown and edited by its type. A property edit
// shows at once and goes to the core; a refusal puts the old value back.

import { useContext, useRef, useState, type ComponentType, type KeyboardEvent } from "react";

import { relativeTime } from "../../../../lib/dates";
import type { NoteMeta } from "../../../../lib/vault/types";
import { isChecked, propOf } from "../../../panel/properties/values";
import { iconOf, titleOf } from "../../../workspace/names";
import { howFromView } from "../../../workspace/store";
import { CALCULATED, CalculatedCue, ProblemChip } from "../../formula/FormulaMark";
import { formulaText } from "../../formula/rows";
import { useCellProblem } from "../../formula/use-formula-rows";
import { valueOf } from "../../model";
import { MultiCell, SelectCell } from "./cells/ChoiceCell";
import { CheckCell, DateCell } from "./cells/DateCell";
import { RelationCell } from "./cells/RelationCell";
import { TextCell } from "./cells/TextCell";
import type { TypeCellProps } from "./cells/types";
import type { Column } from "./columns";
import { useCellHandle, usePending, type Move, type TableCtx } from "./context";
import { own, readableDate } from "./format";
import { Glyph } from "./icons";
import { RowToolsContext } from "./row-tools";
import { TitleRename } from "./TitleRename";
import type { Fold } from "./subitems";
import { dragNotes } from "../../../workspace/drag";
import { Icon } from "../../../../ui/Icon";
import { IconOrEmoji } from "../../../../ui/IconOrEmoji";

export interface CellProps {
  note: NoteMeta;
  column: Column;
  row: number;
  col: number;
  active: boolean;
  editing: boolean;
  seed: string | null;
  ctx: TableCtx;
  id: string;
  /** Sub-items: how far inside other rows this row is, its fold, and whether it only shows for a match below it. */
  depth: number;
  fold: Fold;
  dim: boolean;
  /** The row is picked. */
  selected?: boolean;
}

export function Cell(props: CellProps) {
  switch (props.column.kind) {
    case "title":
      return <TitleCell {...props} />;
    case "builtin":
      return <FieldCell {...props} />;
    default:
      return props.column.def?.type === "formula" ? <FormulaCell {...props} /> : <PropCell {...props} />;
  }
}

const cellClass = (extra: string, active: boolean, editing = false) =>
  `kasten-table-cell ${extra}${active ? " is-active" : ""}${editing ? " is-editing" : ""}`;

/** The title: a click picks it, a double-click or F2 renames it in place.
 * Enter opens the note and Shift+Enter opens it as a full page; Ctrl or the
 * middle button on a click open it in a tab, Shift in the side stack. Space
 * picks the row. */
function TitleCell({ note, row, col, active, ctx, id, depth, fold, dim, selected = false }: CellProps) {
  const tree = fold !== "none";
  const tools = useContext(RowToolsContext);
  const [renaming, setRenaming] = useState(false);
  useCellHandle(
    ctx,
    active && !renaming,
    (e) => {
      if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setRenaming(true);
        return true;
      }
      if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
        tools.pick(note.path, e.shiftKey);
        return true;
      }
      if (e.key !== "Enter") return false;
      // Ctrl+Shift+Enter makes a sub-item of the row.
      if (tree && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (note.kind !== "page") return false;
        ctx.sub.current?.addUnder(note);
        return true;
      }
      // Shift+Enter on its own is the full page; with Ctrl, the usual ways to open.
      ctx.open(note.path, e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey ? "here" : howFromView(e));
      return true;
    },
    tree
      ? (e) => {
          const sub = ctx.sub.current;
          if (!sub?.enabled) return false;
          if (e.key === "ArrowRight" && fold === "closed") sub.toggle(note, true);
          else if (e.key === "ArrowLeft" && fold === "open" && !dim) sub.toggle(note, false);
          else if (e.key === "Tab" && !e.shiftKey) sub.indent(note);
          else if (e.key === "Tab" && depth > 0) sub.outdent(note);
          else return false;
          return true;
        }
      : undefined,
  );
  return (
    <div
      role="rowheader"
      id={id}
      aria-selected={active}
      className={cellClass("is-title", active)}
      style={depth > 0 ? { paddingLeft: `calc(10px + ${depth} * var(--sub-step))` } : undefined}
      draggable={(tree && !renaming) || undefined}
      onDragStart={tree ? (e) => dragNotes(e, [note.path]) : undefined}
      onContextMenu={
        tree
          ? (e) => {
              e.preventDefault();
              ctx.activate(row, col);
              ctx.sub.current?.menu(note, e.clientX, e.clientY);
            }
          : undefined
      }
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onClick={(e) => {
        ctx.activate(row, col);
        // A plain click only picks; Ctrl, Cmd or Shift open the note.
        if (e.ctrlKey || e.metaKey || e.shiftKey) ctx.open(note.path, howFromView(e));
      }}
      onDoubleClick={(e) => {
        if (renaming || e.ctrlKey || e.metaKey || e.shiftKey || (e.target as HTMLElement).closest("button, input")) return;
        setRenaming(true);
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        ctx.activate(row, col);
        ctx.open(note.path, "tab");
      }}
    >
      <input
        type="checkbox"
        tabIndex={-1}
        className="kasten-table-pick"
        aria-label={`Select ${titleOf(note)}`}
        checked={selected}
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation();
          tools.pick(note.path, e.shiftKey);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {tools.ordering && (
        <span
          role="button"
          tabIndex={-1}
          draggable
          className="kasten-table-grip"
          aria-label={`Move ${titleOf(note)}`}
          title="Drag to move this row. With the keyboard, Alt and the up or down arrow."
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => tools.startDrag(e, note)}
        >
          <Icon name="grip" className="size-3.5" />
        </span>
      )}
      {tree && <FoldToggle note={note} fold={fold} ctx={ctx} />}
      <span className="kasten-table-icon" aria-hidden="true">
        <IconOrEmoji icon={iconOf(note)} />
      </span>
      {renaming ? (
        <TitleRename path={note.path} title={titleOf(note)} done={() => setRenaming(false)} />
      ) : (
        <span className="kasten-table-title" title={titleOf(note)}>
          {titleOf(note)}
        </span>
      )}
      <button
        type="button"
        tabIndex={-1}
        className="kasten-table-open"
        aria-label={`Open ${titleOf(note)} beside the table`}
        title="Open beside the table (Shift+Enter opens the full page)"
        onClick={(e) => {
          e.stopPropagation();
          tools.openSide(note.path);
        }}
      >
        Open
      </button>
      {tree && note.kind === "page" && (
        <button
          type="button"
          tabIndex={-1}
          className="kasten-table-add-sub"
          aria-label={`Add a sub-item to ${titleOf(note)}`}
          title="Add a sub-item"
          onClick={(e) => {
            e.stopPropagation();
            ctx.sub.current?.addUnder(note);
          }}
        >
          <Glyph name="plus" />
        </button>
      )}
    </div>
  );
}

/** The ▸ that opens a row's sub-items; a row without any keeps its place. */
function FoldToggle({ note, fold, ctx }: { note: NoteMeta; fold: Fold; ctx: TableCtx }) {
  if (fold === "leaf") return <span className="kasten-table-fold" aria-hidden="true" />;
  const open = fold === "open";
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`kasten-table-fold is-toggle${open ? " is-open" : ""}`}
      aria-label={`${open ? "Collapse" : "Expand"} the sub-items of ${titleOf(note)}`}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        ctx.sub.current?.toggle(note);
      }}
    >
      <Glyph name="chevron" />
    </button>
  );
}

/** What a built-in field says: a time, a day, or for a project's saved tables the note's project, type or tags. */
function fieldText(key: string, raw: unknown): string {
  switch (key) {
    case "modified":
      return typeof raw === "number" && raw > 0 ? relativeTime(raw) : "";
    case "tags":
      return Array.isArray(raw) ? raw.map((t) => `#${String(t)}`).join(" ") : "";
    case "project":
      return typeof raw === "string" ? raw : "";
    case "type":
      return typeof raw === "string" ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
    default:
      return readableDate(raw);
  }
}

/** Created, updated or edited (and project, type and tags in a project's tables): shown, not edited. */
function FieldCell({ note, column, row, col, active, ctx, id }: CellProps) {
  const text = fieldText(column.key, valueOf(note, column.key));
  return (
    <div role="gridcell" id={id} aria-selected={active} aria-readonly="true" className={cellClass("is-field", active)} onClick={() => ctx.activate(row, col)}>
      <span className="kasten-table-text">{text}</span>
    </div>
  );
}

const BODIES: Record<string, ComponentType<TypeCellProps>> = {
  text: TextCell,
  number: TextCell,
  url: TextCell,
  select: SelectCell,
  multi_select: MultiCell,
  date: DateCell,
  checkbox: CheckCell,
  relation: RelationCell,
};

/** Types whose editor starts from the character typed: text, or a search. */
const TYPED = new Set(["text", "number", "url", "select", "multi_select", "relation"]);

/** Types that open a picker on one click; the rest select on a click and edit on a double-click. */
const ONE_CLICK = new Set(["select", "multi_select", "date", "relation"]);

/** What a key does to an active property cell that is not being edited. */
function cellKey(e: KeyboardEvent, type: string, value: unknown, edit: (typed?: string | null) => void, save: (value: unknown) => void): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (type === "checkbox") {
    if (e.key !== "Enter" && e.key !== " ") return false;
    save(!isChecked(value));
    return true;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    save(null);
    return true;
  }
  if (e.key === "Enter" || e.key === " " || e.key === "F2") {
    edit();
    return true;
  }
  if (e.key.length === 1) {
    edit(TYPED.has(type) ? e.key : null);
    return true;
  }
  return false;
}

/** A formula's value: shown, never edited. Keys that would edit another cell do nothing here; an empty cell says why. */
function FormulaCell({ note, column, row, col, active, ctx, id }: CellProps) {
  const why = useCellProblem(note.path, column.key);
  const text = formulaText(valueOf(note, column.key));
  return (
    <div role="gridcell" id={id} aria-selected={active} aria-readonly="true" className={cellClass("is-formula", active)} title={why ?? CALCULATED} onClick={() => ctx.activate(row, col)}>
      {why ? (
        <ProblemChip sentence={why} />
      ) : (
        <>
          {text && <CalculatedCue />}
          <span className="kasten-table-text">{text}</span>
        </>
      )}
    </div>
  );
}

function PropCell({ note, column, row, col, active, editing, seed, ctx, id }: CellProps) {
  const def = column.def!;
  const anchor = useRef<HTMLDivElement>(null);
  const [value, save] = usePending(propOf(note.props, column.key) ?? null, (next) => ctx.save(note.path, column.key, next));
  const edit = (typed: string | null = null) => ctx.edit(note.path, column.key, typed);
  const finish = (move: Move = null, refocus = true) => ctx.done(note.path, column.key, move, refocus);
  useCellHandle(ctx, active && !editing, (e) => cellKey(e, def.type, value, edit, save));
  const Body = own(BODIES, def.type) ?? TextCell;
  return (
    <div
      ref={anchor}
      role="gridcell"
      id={id}
      aria-selected={active}
      className={cellClass(`is-${def.type.replace("_", "-")}`, active, editing)}
      onClick={() => {
        // Clicks inside an open editor (its menu too) stay there.
        if (editing) return;
        ctx.activate(row, col);
        // Pickers open on a click; text, numbers and links wait for a double-click.
        if (ONE_CLICK.has(def.type)) edit();
      }}
      onDoubleClick={() => {
        if (!editing && !ONE_CLICK.has(def.type) && def.type !== "checkbox") edit();
      }}
    >
      <Body value={value} def={def} editing={editing} seed={seed} label={`${column.label} of ${titleOf(note)}`} path={note.path} anchor={anchor} save={save} finish={finish} />
    </div>
  );
}
