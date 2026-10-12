// One cell of the table: the title (opens the note), a built-in field
// (read-only) or a property, shown and edited by its type. A property edit
// shows at once and goes to the core; a refusal puts the old value back.

import { useRef, type ComponentType, type KeyboardEvent } from "react";

import { relativeTime } from "../../../../lib/dates";
import type { NoteMeta } from "../../../../lib/vault/types";
import { isChecked, propOf } from "../../../panel/properties/values";
import { iconOf, titleOf } from "../../../workspace/names";
import { howFromView } from "../../../workspace/store";
import { valueOf } from "../../model";
import { MultiCell, SelectCell } from "./cells/ChoiceCell";
import { CheckCell, DateCell } from "./cells/DateCell";
import { RelationCell } from "./cells/RelationCell";
import { TextCell } from "./cells/TextCell";
import type { TypeCellProps } from "./cells/types";
import type { Column } from "./columns";
import { useCellHandle, usePending, type Move, type TableCtx } from "./context";
import { own, readableDate } from "./format";
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
}

export function Cell(props: CellProps) {
  switch (props.column.kind) {
    case "title":
      return <TitleCell {...props} />;
    case "builtin":
      return <FieldCell {...props} />;
    default:
      return <PropCell {...props} />;
  }
}

const cellClass = (extra: string, active: boolean, editing = false) =>
  `kasten-table-cell ${extra}${active ? " is-active" : ""}${editing ? " is-editing" : ""}`;

/** The title: a click opens the note (Ctrl or the middle button in a tab,
 * Shift in the side stack), and so does Enter. */
function TitleCell({ note, row, col, active, ctx, id }: CellProps) {
  useCellHandle(ctx, active, (e) => {
    if (e.key !== "Enter") return false;
    ctx.open(note.path, howFromView(e));
    return true;
  });
  return (
    <div
      role="rowheader"
      id={id}
      aria-selected={active}
      className={cellClass("is-title", active)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onClick={(e) => {
        ctx.activate(row, col);
        ctx.open(note.path, howFromView(e));
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        ctx.activate(row, col);
        ctx.open(note.path, "tab");
      }}
    >
      <span className="kasten-table-icon" aria-hidden="true">
        <IconOrEmoji icon={iconOf(note)} />
      </span>
      <span className="kasten-table-title" title={titleOf(note)}>
        {titleOf(note)}
      </span>
    </div>
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
        if (def.type !== "checkbox") edit();
      }}
    >
      <Body value={value} def={def} editing={editing} seed={seed} label={`${column.label} of ${titleOf(note)}`} path={note.path} anchor={anchor} save={save} finish={finish} />
    </div>
  );
}
