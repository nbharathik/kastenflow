// The table of numbers behind a chart, and the changes the data editor makes to it. Each function gives a new table and leaves
// the one it was given alone, so the panel can write the whole of it back as one patch (one step of undo).

import type { ChartSeries } from "@kasten-slides/wasm";

export interface ChartTable {
  /** The name of each row: a bar group, a point on the line, a slice. */
  categories: string[];
  /** A name and a number for each category. */
  series: ChartSeries[];
}

/** The most rows and columns a pasted table makes: more would not be read from a slide. */
export const MOST_CATEGORIES = 40;
export const MOST_SERIES = 8;

/** Every series has a number for each category: short ones are padded with zeros, long ones cut. */
export function fit(table: ChartTable): ChartTable {
  const n = table.categories.length;
  return { categories: table.categories, series: table.series.map((s) => ({ ...s, values: Array.from({ length: n }, (_, i) => s.values[i] ?? 0) })) };
}

export const addCategory = (table: ChartTable): ChartTable =>
  fit({ categories: [...table.categories, `Category ${table.categories.length + 1}`], series: table.series.map((s) => ({ ...s, values: [...s.values, 0] })) });

export const removeCategory = (table: ChartTable, at: number): ChartTable => ({
  categories: table.categories.filter((_, i) => i !== at),
  series: table.series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== at) })),
});

export const addSeries = (table: ChartTable): ChartTable => ({
  categories: table.categories,
  series: [...table.series, { name: `Series ${table.series.length + 1}`, values: table.categories.map(() => 0) }],
});

export const removeSeries = (table: ChartTable, at: number): ChartTable => ({ categories: table.categories, series: table.series.filter((_, i) => i !== at) });

export const setCategory = (table: ChartTable, at: number, name: string): ChartTable => ({ categories: table.categories.map((c, i) => (i === at ? name : c)), series: table.series });

export const setSeriesName = (table: ChartTable, at: number, name: string): ChartTable => ({ categories: table.categories, series: table.series.map((s, i) => (i === at ? { ...s, name } : s)) });

export const setValue = (table: ChartTable, series: number, category: number, value: number): ChartTable =>
  fit({ categories: table.categories, series: table.series.map((s, i) => (i === series ? { ...s, values: s.values.map((v, c) => (c === category ? value : v)) } : s)) });

/** One line of text as cells: split at the delimiter, a cell in double quotes may hold the delimiter and a doubled quote stands for one. */
function cellsOf(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/** Text from a spreadsheet (tab-separated) or a CSV file (commas, or semicolons) as rows of cells. Blank lines at the end are dropped. */
export function splitRows(text: string): { rows: string[][]; delimiter: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === "") lines.pop();
  // A tab wins (a spreadsheet); a semicolon comes before a comma, since a file with decimal commas separates with semicolons. What is
  // inside quotes does not count.
  const bare = lines.map((l) => l.replace(/"(?:[^"]|"")*"/g, ""));
  const delimiter = bare.some((l) => l.includes("\t")) ? "\t" : bare.some((l) => l.includes(";")) ? ";" : bare.some((l) => l.includes(",")) ? "," : "\t";
  return { rows: lines.map((l) => cellsOf(l, delimiter)), delimiter };
}

/** A number as a spreadsheet writes it ("1,234", "12%", "$5"); null for anything that is not one. */
export function numberOf(cell: string, delimiter = "\t"): number | null {
  let s = cell.trim().replace(/[%$€£\s]/g, "");
  // Commas are thousands in a spreadsheet's text, and the decimal point in a CSV written with semicolons.
  if (delimiter === "\t") s = s.replace(/,/g, "");
  else if (delimiter === ";") s = s.replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * The table in pasted text: the first column names the categories, the others are series of numbers. A first row of words is the
 * names of the series. `keep` is the table so far: the colour of a series stays with its place. Null when the text holds no table.
 */
export function tableFromText(text: string, keep?: ChartTable): ChartTable | null {
  const { rows: all, delimiter } = splitRows(text);
  if (all.length === 0) return null;
  const head = all[0] as string[];
  // A first row of words (or of years, which are numbers but name a series) is the names of the series, unless the row under it reads the same way.
  const named = (row: string[]) => row.slice(1).every((cell) => numberOf(cell, delimiter) === null || /^\s*(19|20)\d\d\s*$/.test(cell));
  const header = all.length > 1 && head.length > 1 && named(head) && !(all[1]!.length > 1 && named(all[1]!));
  const rows = (header ? all.slice(1) : all).slice(0, MOST_CATEGORIES);
  const width = Math.min(Math.max(...rows.map((r) => r.length)), MOST_SERIES + 1);
  if (rows.length === 0) return null;
  // One column: the numbers alone, numbered 1, 2, 3.
  if (width === 1) {
    const values = rows.map((r) => numberOf(r[0] ?? "", delimiter));
    if (values.some((v) => v === null)) return null;
    return { categories: rows.map((_, i) => String(i + 1)), series: [{ name: "Series 1", values: values as number[], ...colourAt(keep, 0) }] };
  }
  const categories = rows.map((r, i) => (r[0] ?? "").trim() || String(i + 1));
  const series: ChartSeries[] = Array.from({ length: width - 1 }, (_, j) => ({
    name: (header ? (head[j + 1] ?? "") : "").trim() || `Series ${j + 1}`,
    values: rows.map((r) => numberOf(r[j + 1] ?? "", delimiter) ?? 0),
    ...colourAt(keep, j),
  }));
  return { categories, series };
}

const colourAt = (keep: ChartTable | undefined, at: number): { color?: string } => {
  const color = keep?.series[at]?.color;
  return color ? { color } : {};
};
