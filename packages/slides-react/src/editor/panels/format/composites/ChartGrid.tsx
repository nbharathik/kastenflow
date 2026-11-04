import { type ClipboardEvent, useState } from "react";

import { IconButton, TextButton } from "../../../ui/Button.tsx";
import { NumberField } from "../../../ui/Fields.tsx";
import { TextField } from "../controls.tsx";
import { type ChartTable, MOST_CATEGORIES, MOST_SERIES, addCategory, addSeries, removeCategory, removeSeries, setCategory, setSeriesName, setValue, tableFromText } from "./chart-data.ts";

interface ChartGridProps {
  table: ChartTable;
  /** Writes the whole table back: one change is one step of undo. */
  onChange(table: ChartTable): void;
}

/**
 * The numbers of a chart as a grid: a column for each series, a row for each category. Rows and columns can be added and taken away,
 * and cells copied from a spreadsheet (or the text of a CSV file) can be pasted into any box or into the box below, to replace the table.
 */
export function ChartGrid({ table, onChange }: ChartGridProps) {
  const [pasting, setPasting] = useState(false);
  const [typed, setTyped] = useState("");
  const [bad, setBad] = useState(false);

  const replaceWith = (text: string): boolean => {
    const next = tableFromText(text, table);
    if (next) onChange(next);
    return next !== null;
  };

  // Several cells from a spreadsheet are a table; one value pasted into a box is only that value.
  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    // The box for pasted text takes it as text, to be read when the button is pressed.
    if ((event.target as HTMLElement).tagName === "TEXTAREA") return;
    const text = event.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return;
    if (replaceWith(text)) event.preventDefault();
  };

  const onlyRow = table.categories.length <= 1;
  const onlyColumn = table.series.length <= 1;

  return (
    <div className="ks-cs-chart" onPaste={onPaste}>
      <div className="ks-cs-chart-wrap">
        <table className="ks-cs-chart-grid" aria-label="Chart data">
          <thead>
            <tr>
              <td />
              {table.series.map((s, j) => (
                <th key={j} scope="col">
                  <div className="ks-cs-chart-head">
                    <TextField label={`Name of series ${j + 1}`} value={s.name} placeholder={`Series ${j + 1}`} onCommit={(name) => onChange(setSeriesName(table, j, name))} />
                    <IconButton icon="trash" label={`Remove series ${j + 1}`} disabled={onlyColumn} onClick={() => onChange(removeSeries(table, j))} />
                  </div>
                </th>
              ))}
              <td />
            </tr>
          </thead>
          <tbody>
            {table.categories.map((name, i) => (
              <tr key={i}>
                <th scope="row">
                  <TextField label={`Name of category ${i + 1}`} value={name} placeholder={`Category ${i + 1}`} onCommit={(next) => onChange(setCategory(table, i, next))} />
                </th>
                {table.series.map((s, j) => (
                  <td key={j}>
                    <NumberField label={`Value of series ${j + 1}, category ${i + 1}`} decimals={3} width={64} value={s.values[i] ?? 0} onCommit={(n) => onChange(setValue(table, j, i, n))} />
                  </td>
                ))}
                <td>
                  <IconButton icon="trash" label={`Remove category ${i + 1}`} disabled={onlyRow} onClick={() => onChange(removeCategory(table, i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ks-sp-inline">
        <TextButton disabled={table.categories.length >= MOST_CATEGORIES} onClick={() => onChange(addCategory(table))}>
          Add row
        </TextButton>
        <TextButton disabled={table.series.length >= MOST_SERIES} onClick={() => onChange(addSeries(table))}>
          Add column
        </TextButton>
        <TextButton aria-expanded={pasting} onClick={() => setPasting(!pasting)}>
          Paste data
        </TextButton>
      </div>
      {pasting ? (
        <div className="ks-cs-chart-paste">
          <textarea
            className="ks-input ks-sp-area"
            rows={4}
            aria-label="Pasted table"
            aria-invalid={bad || undefined}
            placeholder={"Paste cells from a spreadsheet, or CSV text.\nNames in the first column, numbers after."}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setBad(false);
            }}
          />
          <div className="ks-sp-inline">
            <TextButton
              disabled={typed.trim() === ""}
              onClick={() => {
                if (replaceWith(typed)) {
                  setTyped("");
                  setPasting(false);
                } else setBad(true);
              }}
            >
              Replace the data
            </TextButton>
            {bad ? (
              <span className="ks-sp-hint" role="alert">
                No table found in that text.
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="ks-sp-hint">Paste cells from a spreadsheet into the grid to replace its data. A first row of words names the series.</p>
      )}
    </div>
  );
}
