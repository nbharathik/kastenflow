// A group's header row: a fold button, the group's name and how many notes it
// holds, then the group's calculations under the columns that have one. It is
// one row high like the rest, so the list stays windowed.

import { memo } from "react";

import type { Column } from "./columns";
import { Glyph } from "./icons";
import type { GroupState } from "./rows-select";
import type { GroupHead } from "./useGroups";

interface Props {
  head: GroupHead;
  columns: Column[];
  /** Its place among the rows drawn, from 0. */
  pos: number;
  toggle(id: string | null): void;
  /** The header's own menu (fold or open every group), at a point on the screen. */
  menu(x: number, y: number): void;
  /** How many of the group's rows are picked, and the checkbox that picks them all. */
  picked?: GroupState;
  pick?(id: string | null): void;
}

export const GroupRow = memo(function GroupRow({ head, columns, pos, toggle, menu, picked = "none", pick }: Props) {
  const open = !head.collapsed;
  return (
    <div
      role="row"
      aria-rowindex={pos + 2}
      aria-expanded={open}
      className="kasten-table-row kasten-table-group"
      onContextMenu={(e) => {
        e.preventDefault();
        menu(e.clientX, e.clientY);
      }}
    >
      {columns.map((column, col) =>
        col === 0 ? (
          <div key={column.key} role="rowheader" className="kasten-table-cell is-title is-group">
            {pick && (
              <input
                type="checkbox"
                tabIndex={-1}
                className="kasten-table-pick"
                aria-label={`Select all in ${head.label}`}
                checked={picked === "all"}
                ref={(el) => {
                  if (el) el.indeterminate = picked === "some";
                }}
                onChange={() => pick(head.id)}
              />
            )}
            <button type="button" tabIndex={-1} className="kasten-table-group-button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} the group ${head.label}`} onClick={() => toggle(head.id)}>
              <Glyph name="chevron" className={`kasten-table-group-chevron${open ? " is-open" : ""}`} />
              <span className="kasten-table-group-name">{head.label}</span>
              <span className="kasten-table-group-count">{head.count.toLocaleString()}</span>
            </button>
          </div>
        ) : (
          <div key={column.key} role="gridcell" aria-readonly="true" className="kasten-table-cell is-group-calc">
            <span className="kasten-table-text">{head.calcs[column.key] ?? ""}</span>
          </div>
        ),
      )}
      <div role="presentation" className="kasten-table-fill" />
    </div>
  );
});
