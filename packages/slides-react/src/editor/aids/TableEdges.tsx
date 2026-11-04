import { type JSX, type PointerEvent, useRef, useState } from "react";

import { layoutTable } from "../../render/table-layout.ts";
import type { EditorSession } from "../session/session.ts";
import { useEditor } from "../useEditor.ts";
import "./aids.css";

/** The narrowest a column is dragged to, in slide units: the same as the engine's. */
const NARROWEST = 12;

/**
 * A handle on the line after each column of the table that is selected, dragged to change the column's width. The column after it gives or
 * takes the difference, and the last column widens the table. The width is written when the handle is let go: one step of undo.
 */
export function TableEdges({ session, zoom }: { session: EditorSession; zoom: number }): JSX.Element | null {
  const state = useEditor(session);
  /** The handle being dragged, and how far it has moved in slide units. */
  const [drag, setDrag] = useState<{ index: number; by: number } | null>(null);
  const from = useRef({ x: 0, width: 0 });
  const only = state.selection.length === 1 ? state.selection[0] : undefined;
  const table = only ? state.deck.slides.find((s) => s.id === state.slideId)?.elements.find((e) => e.id === only) : undefined;
  if (table?.type !== "table" || table.locked || state.editing !== null || table.x == null || table.y == null || table.w == null || table.h == null || table.rotation) return null;
  const layout = layoutTable(table, table.w, table.h);
  const wanted = (event: PointerEvent): number => Math.max(NARROWEST, from.current.width + (event.clientX - from.current.x) / zoom);

  let edge = 0;
  return (
    <div className="ks-table-edges" data-chrome="" style={{ left: table.x * zoom, top: table.y * zoom, height: table.h * zoom }}>
      {layout.columns.map((width, index) => {
        edge += width;
        const shift = drag?.index === index ? drag.by : 0;
        return (
          <span
            key={index}
            className="ks-table-edge"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Width of column ${index + 1}`}
            style={{ left: (edge + shift) * zoom }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              from.current = { x: event.clientX, width };
              setDrag({ index, by: 0 });
            }}
            onPointerMove={(event) => drag?.index === index && setDrag({ index, by: wanted(event) - width })}
            onPointerUp={(event) => {
              if (drag?.index !== index) return;
              setDrag(null);
              session.aids.resizeColumn(state.slideId, table.id, index, Math.round(wanted(event) * 10) / 10);
            }}
            onPointerCancel={() => setDrag(null)}
          />
        );
      })}
    </div>
  );
}
