import { rowsIn, colsIn } from "../../table/cells.ts";
import { IconButton, TextButton } from "../../ui/Button.tsx";
import { Cluster, Row, TriToggle } from "./controls.tsx";
import { PanelSection } from "./PanelSection.tsx";
import { addAtEnd, canShrink, removeAtEnd } from "./table-edit.ts";
import type { SectionProps } from "./types.ts";
import { agree, only } from "./values.ts";
import { patchEach } from "./write.ts";

/**
 * The rows and columns of a table, whether its first row is a header, and what can be done to the cells picked in it. The steppers add and
 * take away the last row or column, or, with cells picked, as many rows or columns as are picked, after or at them.
 */
export function TableSection({ session, elements }: SectionProps) {
  const tables = only(elements, "table");
  const rows = agree(tables.map((t) => t.rows.length), 0);
  const columns = agree(tables.map((t) => t.columns.length), 0);
  const header = agree(tables.map((t) => Boolean(t.headerRow)), false);
  const picked = session.tables.picked();
  // Cells picked in the one table that is selected: the steppers then work at them.
  const here = picked !== null && tables.length === 1 && tables[0]?.id === picked.cells.table ? picked : null;

  const change = (along: "row" | "column", kind: "add" | "remove") => {
    if (here) {
      if (along === "row") return kind === "add" ? session.tables.insertRows("below") : session.tables.deleteRows();
      return kind === "add" ? session.tables.insertColumns("right") : session.tables.deleteColumns();
    }
    return kind === "add" ? addAtEnd(session, tables, along) : removeAtEnd(session, tables, along);
  };
  /** Whether the stepper cannot take away: a table keeps a row and a column, so not all of them. */
  const cannotRemove = (along: "row" | "column", count: number | "mixed"): boolean => {
    if (here) return along === "row" ? rowsIn(here.range) >= here.grid.rows : colsIn(here.range) >= here.grid.cols;
    return count !== "mixed" ? count <= 1 : tables.some((table) => !canShrink(table, along));
  };

  const stepper = (name: "row" | "column", count: number | "mixed") => (
    <Row label={name === "row" ? "Rows" : "Columns"}>
      <Cluster label={name === "row" ? "Rows" : "Columns"}>
        <IconButton icon="minus" label={`Remove ${name}`} disabled={cannotRemove(name, count)} onClick={() => change(name, "remove")} />
        <output className="ks-sp-count" aria-label={`${name === "row" ? "Rows" : "Columns"} in the table`}>
          {count === "mixed" ? "—" : count}
        </output>
        <IconButton icon="plus" label={`Add ${name}`} onClick={() => change(name, "add")} />
      </Cluster>
    </Row>
  );

  const act = (name: string, run: () => void, enabled = true) => (
    <TextButton key={name} aria-label={name} disabled={!enabled} onClick={run}>
      {name}
    </TextButton>
  );

  return (
    <PanelSection id="table" title="Table">
      {stepper("row", rows)}
      {stepper("column", columns)}
      <TriToggle label="Header row" on={header} onChange={(next) => patchEach(session, tables, (t) => (Boolean(t.headerRow) === next ? null : { headerRow: next }))} />
      {here ? (
        <Row label="Cells" wide>
          <div className="ks-sp-cellbar" role="group" aria-label="Cells picked">
            {act("Insert row above", () => session.tables.insertRows("above"))}
            {act("Insert row below", () => session.tables.insertRows("below"))}
            {act("Insert column left", () => session.tables.insertColumns("left"))}
            {act("Insert column right", () => session.tables.insertColumns("right"))}
            {act("Merge cells", () => session.tables.merge(), session.tables.canMerge)}
            {act("Unmerge cells", () => session.tables.unmerge(), session.tables.canUnmerge)}
          </div>
        </Row>
      ) : null}
    </PanelSection>
  );
}
