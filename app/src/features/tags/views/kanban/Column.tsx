// One column of the board: the option it stands for as a coloured chip with
// its count, its cards in the view's order, and "+ New" at the foot. An
// empty column stays as a place to drop cards. A value the schema does not
// list (a card written elsewhere) gets a column too, which cards can leave
// but not join, since the core writes only the select's options.

import { memo, useRef, useState, type CSSProperties } from "react";

import { useFlip } from "../../../../lib/flip";
import type { PropDef } from "../../../../lib/vault/types";
import { optionSwatch } from "../../../panel/properties/schemas";
import type { Column } from "../../model";
import { columnKey, takesCards } from "./model";
import { Card } from "./Card";
import { QuickAdd } from "./QuickAdd";

/** Past this many cards, a column lays out only the ones in view (board.css). */
const LONG = 40;

interface ColumnProps {
  column: Column;
  /** The select the board groups by. */
  def: PropDef;
  /** The properties cards show. */
  defs: readonly PropDef[];
  colorBy: PropDef | null;
  today: string;
}

export const BoardColumn = memo(function BoardColumn({ column, def, defs, colorBy, today }: ColumnProps) {
  const [adding, setAdding] = useState(false);
  const cards = useRef<HTMLUListElement>(null);
  // Cards slide to their place when one is added, moved or dropped; a very
  // long column is left alone (the long-column layout is cheap on purpose).
  useFlip(cards, column.notes.length > LONG ? "" : column.notes.map((n) => n.path).join("\n"));
  const takes = takesCards(column.value, def);
  const tone = column.value === null ? null : optionSwatch(column.value, def.options);
  const count = column.notes.length;
  const style = tone ? ({ "--col-fg": tone.fg, "--col-bg": tone.bg } as CSSProperties) : undefined;
  return (
    <section
      aria-label={column.label}
      className={`kasten-kanban-col${column.value === null ? " is-none" : ""}`}
      data-column={columnKey(column.value)}
      data-refuses={takes ? undefined : ""}
      style={style}
    >
      <header className="kasten-kanban-head" title={takes ? undefined : `“${column.label}” is not one of the options of ${def.key}: cards can leave this column but not join it`}>
        <span className="kasten-kanban-label">{column.label}</span>
        <span className="kasten-kanban-count" aria-label={`${count} ${count === 1 ? "card" : "cards"}`}>
          {count.toLocaleString()}
        </span>
      </header>
      <ul ref={cards} className={`kasten-kanban-cards${count > LONG ? " is-long" : ""}`} data-cards aria-label={`Cards in ${column.label}`}>
        {column.notes.map((note) => (
          <Card key={note.path} note={note} defs={defs} colorBy={colorBy} today={today} />
        ))}
        {count === 0 && (
          <li className="kasten-kanban-empty" aria-hidden="true">
            {takes ? "Drop cards here" : "No cards"}
          </li>
        )}
      </ul>
      {takes &&
        (adding ? (
          <QuickAdd value={column.value} label={column.label} onClose={() => setAdding(false)} />
        ) : (
          <button type="button" className="kasten-kanban-new" aria-label={`New card in ${column.label}`} onClick={() => setAdding(true)}>
            <span aria-hidden="true">+</span> New
          </button>
        ))}
    </section>
  );
});
