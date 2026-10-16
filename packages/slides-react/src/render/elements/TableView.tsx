import type { JSX } from "react";

import { colorOf } from "../../theme/index.ts";
import type { ViewProps } from "../context.ts";
import { layoutTable } from "../table-layout.ts";
import { boldText } from "../text-props.ts";
import { TextArea } from "./TextArea.tsx";
import { Upright } from "./Upright.tsx";

/** How the thin lines between cells are drawn: the theme's second text colour, faded. */
const GRID_ALPHA = 0.3;

/** A table drawn as an HTML table that fills its box; the words in each cell are set by the text module. */
export function TableView({ element, box, cx, hideText, hideCell }: ViewProps<"table">): JSX.Element {
  const { theme } = cx;
  const layout = layoutTable(element, box.w, box.h);
  const grid = colorOf(theme, "text2", GRID_ALPHA);
  const table = (
    <table className="ks-table" style={{ width: box.w, height: box.h }}>
      <colgroup>
        {layout.columns.map((width, at) => (
          <col key={at} style={{ width }} />
        ))}
      </colgroup>
      <tbody>
        {layout.cells.map((cells, r) => (
          <tr key={r} style={{ height: layout.rows[r] }}>
            {cells.map((laid) => (
              <td
                key={laid.col}
                colSpan={laid.colSpan}
                rowSpan={laid.rowSpan}
                style={{ borderColor: grid, background: laid.cell.fill ? colorOf(theme, laid.cell.fill.color, laid.cell.fill.alpha) : undefined }}
              >
                {!hideText && !(hideCell && hideCell.row === laid.row && hideCell.col === laid.col) && (
                  <TextArea
                    cx={cx}
                    text={laid.header ? boldText(laid.cell.text) : laid.cell.text}
                    baseStyle="body"
                    width={laid.width}
                    height={laid.height}
                    valign={laid.cell.text.valign ?? "top"}
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  // A table is never mirrored: what its box is flipped by is undone.
  return element.flipH || element.flipV ? (
    <Upright flipH={element.flipH} flipV={element.flipV}>
      {table}
    </Upright>
  ) : (
    table
  );
}
