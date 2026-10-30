// The calculations under the rows: one cell per column that says what the
// column makes of the rows the view shows (the filtered ones, folded
// sub-items and groups included). A click on a cell picks the calculation
// from the ones the column's type offers; the choice is saved with the view.

import { memo, useMemo, useRef, useState, type RefObject } from "react";

import type { NoteMeta, TagView } from "../../../../lib/vault/types";
import { calcOf, calcsFor, calculate, calcText, CALC_LABELS, kindOf, withCalc, type CalcFn } from "./calc";
import type { Column } from "./columns";
import { useMenuKeys } from "./ColumnMenu";
import { Floating } from "./Floating";
import { Glyph } from "./icons";

interface Props {
  columns: Column[];
  view: TagView;
  /** The rows the view shows, whole. */
  notes: readonly NoteMeta[];
  /** Past the last row: its place among the rows drawn. */
  pos: number;
  change(next: TagView): void;
}

export const CalcFoot = memo(function CalcFoot({ columns, view, notes, pos, change }: Props) {
  const texts = useMemo(
    () =>
      columns.map((column) => {
        const fn = calcOf(view, column);
        return fn ? calcText(fn, calculate(fn, notes, column.key, kindOf(column))) : null;
      }),
    [columns, view, notes],
  );
  return (
    <div role="row" aria-rowindex={pos + 2} className="kasten-table-calcs">
      {columns.map((column, col) => (
        <CalcCell key={column.key} column={column} view={view} text={texts[col]!} sticky={col === 0} change={change} />
      ))}
      <div role="presentation" className="kasten-table-fill" />
    </div>
  );
});

interface CellProps {
  column: Column;
  view: TagView;
  text: string | null;
  sticky: boolean;
  change(next: TagView): void;
}

function CalcCell({ column, view, text, sticky, change }: CellProps) {
  const [open, setOpen] = useState(false);
  const cell = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  return (
    <div ref={cell} role="gridcell" className={`kasten-table-calc-cell${sticky ? " is-title" : ""}`}>
      <button
        ref={button}
        type="button"
        className={`kasten-table-calc${text ? " is-set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={text ? `${column.label}: ${text}. Change the calculation` : `Calculate ${column.label}`}
        title={text ? "Change the calculation" : "Calculate"}
        onClick={() => setOpen((o) => !o)}
      >
        {text ?? <span className="kasten-table-calc-hint">Calculate</span>}
      </button>
      {open && <CalcMenu anchor={cell} column={column} view={view} change={change} onClose={close} />}
    </div>
  );
}

function CalcMenu({ anchor, column, view, change, onClose }: { anchor: RefObject<HTMLElement | null>; column: Column; view: TagView; change(next: TagView): void; onClose(refocus: boolean): void }) {
  const { menu, onKeyDown } = useMenuKeys(() => onClose(true));
  const current = calcOf(view, column);
  const choose = (fn: CalcFn | null) => {
    onClose(true);
    if (fn !== current) change(withCalc(view, column.key, fn));
  };
  return (
    <Floating anchor={anchor} role="menu" label={`Calculate ${column.label}`} onClose={() => onClose(false)} minWidth={200}>
      <div ref={menu} className="kasten-table-menu" onKeyDown={onKeyDown}>
        <button type="button" role="menuitemradio" aria-checked={current === null} className="kasten-table-menu-item" onClick={() => choose(null)}>
          <Glyph name={current === null ? "tick" : "close"} />
          <span>None</span>
        </button>
        <hr className="kasten-table-menu-line" />
        {calcsFor(kindOf(column)).map((fn) => (
          <button key={fn} type="button" role="menuitemradio" aria-checked={current === fn} className="kasten-table-menu-item" onClick={() => choose(fn)}>
            <Glyph name={current === fn ? "tick" : "text"} />
            <span>{CALC_LABELS[fn].menu}</span>
          </button>
        ))}
      </div>
    </Floating>
  );
}
