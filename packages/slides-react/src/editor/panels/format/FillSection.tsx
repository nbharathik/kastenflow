import type { Element, Fill } from "@kasten-slides/wasm";

import type { Patch } from "../../session/elements.ts";
import { changeFills, fillCells } from "../../table/fill.ts";
import { TextButton } from "../../ui/Button.tsx";
import { ColorButton, Row, Slider } from "./controls.tsx";
import { PanelSection } from "./PanelSection.tsx";
import type { SectionProps } from "./types.ts";
import { agree, only, same } from "./values.ts";
import { patchEach } from "./write.ts";

/** The patch that gives a shape or a text box the fill `change` makes of its own; null when that changes nothing. */
function withFill(element: Element, change: (fill: Fill | null) => Fill | null): Patch | null {
  const now = element.style?.fill ?? null;
  const next = change(now);
  if (same(now, next)) return null;
  // A merge patch keeps what it does not name: a fill that lost its opacity must say so.
  return { style: { fill: next ? { color: next.color, alpha: next.alpha ?? null } : null } };
}

/** The colour and opacity of what is inside a shape, a text box or the cells of a table (those picked, else all of them). */
export function FillSection({ session, elements, theme }: SectionProps) {
  const tables = only(elements, "table");
  const others = elements.filter((element) => element.type !== "table");
  const fills = [...others.map((element) => element.style?.fill ?? null), ...tables.flatMap((table) => fillCells(session, table).map((laid) => laid.cell.fill ?? null))];
  const filled = fills.filter((fill): fill is Fill => fill !== null);
  const colour = agree(fills.map((fill) => fill?.color ?? null), null);
  const opacity = agree(filled.map((fill) => Math.round((fill.alpha ?? 1) * 100)), 100);
  const apply = (change: (fill: Fill | null) => Fill | null) => {
    patchEach(session, others, (element) => withFill(element, change));
    // The cells of a table are filled with the engine's own operations, over the cells picked or the whole table.
    changeFills(session, tables, change);
  };
  const picked = tables.some((table) => session.state.cells?.table === table.id);
  return (
    <PanelSection id="fill" title={picked ? "Fill of the cells" : "Fill"}>
      <Row label="Colour">
        <ColorButton
          theme={theme}
          label="Fill colour"
          value={colour}
          onPick={(picked) => apply(picked === null ? () => null : (fill) => ({ ...fill, color: picked }))}
        />
        <TextButton disabled={filled.length === 0} onClick={() => apply(() => null)}>
          None
        </TextButton>
      </Row>
      <Row label="Opacity">
        <Slider label="Fill opacity" value={opacity} disabled={filled.length === 0} onCommit={(percent) => apply((fill) => (fill ? { ...fill, alpha: percent >= 100 ? null : percent / 100 } : null))} />
      </Row>
    </PanelSection>
  );
}
