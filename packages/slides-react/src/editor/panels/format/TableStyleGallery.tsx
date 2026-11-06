import type { TableEl } from "@kasten-slides/wasm";
import type { JSX } from "react";

import { TABLE_STYLES, cellLook } from "../../../render/table-style.ts";
import { colorOf } from "../../../theme/index.ts";
import { TextButton } from "../../ui/Button.tsx";
import { Toggle } from "../../ui/Fields.tsx";
import { useEditor } from "../../useEditor.ts";
import type { EditorSession } from "../../session/session.ts";
import { type CellSelection, rangeOfSelection, rowsIn } from "../../table/cells.ts";
import "./table-style.css";

/** A style's look in nine little cells, drawn with the theme's colours. */
function Swatch({ session, preset }: { session: EditorSession; preset: string }): JSX.Element {
  const { theme } = useEditor(session).deck;
  return (
    <span className="ks-ts-swatch" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const [row, col] = [Math.floor(i / 3), i % 3];
        const look = cellLook({ preset, bandedRows: true }, true, 3, 3, row, col);
        return <i key={i} style={{ background: look.fill ? colorOf(theme, look.fill.color, look.fill.alpha) : colorOf(theme, "bg1"), borderBottom: look.bottom ? `1px solid ${colorOf(theme, look.bottom.color, look.bottom.alpha)}` : undefined }} />;
      })}
    </span>
  );
}

/** The styles a table can have, the parts a style sets apart, and the lines of the cells picked. */
export function TableStyleGallery({ session, tables, picked }: { session: EditorSession; tables: readonly TableEl[]; picked: CellSelection | null }): JSX.Element {
  const slide = session.slide.id;
  const first = tables[0];
  const style = first?.tableStyle ?? undefined;
  const each = (change: (id: string) => void) => tables.forEach((t) => change(t.id));
  const block = picked && tables.length === 1 && first ? rangeOfSelection(first, picked) : null;
  const lines = (sides: string[], stroke?: { color: string; width: number }) =>
    block && first && session.aids.setCellBorders(slide, first.id, { row: block.top, col: block.left }, { row: block.bottom, col: block.right }, sides, stroke);
  return (
    <div className="ks-sp-field" role="group" aria-label="Table style">
      <span className="ks-sp-label">Style</span>
      <div className="ks-ts-gallery">
        {TABLE_STYLES.map((p) => (
          <button key={p.id} type="button" className="ks-ts-style" aria-label={p.label} aria-pressed={style?.preset === p.id} title={p.label} onClick={() => each((id) => session.aids.setTableStyle(slide, id, { preset: p.id }))}>
            <Swatch session={session} preset={p.id} />
          </button>
        ))}
      </div>
      <TextButton disabled={!style} onClick={() => each((id) => session.aids.setTableStyle(slide, id, { preset: "none" }))}>
        No style
      </TextButton>
      {style ? (
        <>
          <Toggle label="Banded rows" on={Boolean(style.bandedRows)} onChange={(on) => each((id) => session.aids.setTableStyle(slide, id, { bandedRows: on }))} />
          <Toggle label="First column" on={Boolean(style.firstColumn)} onChange={(on) => each((id) => session.aids.setTableStyle(slide, id, { firstColumn: on }))} />
          <Toggle label="Last row" on={Boolean(style.lastRow)} onChange={(on) => each((id) => session.aids.setTableStyle(slide, id, { lastRow: on }))} />
        </>
      ) : null}
      <div role="group" aria-label="Even out">
        <TextButton onClick={() => each((id) => session.aids.distributeTable(slide, id, "rows"))}>Even rows</TextButton>
        <TextButton onClick={() => each((id) => session.aids.distributeTable(slide, id, "columns"))}>Even columns</TextButton>
      </div>
      {block ? (
        <div role="group" aria-label={`Borders of ${rowsIn(block)} row${rowsIn(block) === 1 ? "" : "s"} picked`}>
          <TextButton onClick={() => lines(["all"], { color: "text2", width: 1 })}>All borders</TextButton>
          <TextButton onClick={() => lines(["outer"], { color: "text1", width: 2 })}>Outside</TextButton>
          <TextButton onClick={() => lines(["all"], { color: "text2", width: 0 })}>No borders</TextButton>
          <TextButton onClick={() => lines(["all"])}>Follow style</TextButton>
        </div>
      ) : null}
    </div>
  );
}
