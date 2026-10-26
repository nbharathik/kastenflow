// "Copy as CSV": a table's cells as comma-separated values (RFC 4180): a field
// with a comma, a quote or a line break is quoted, a quote inside is doubled,
// lines end in CRLF.

import type { Grid } from "./grid";

function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(grid: Pick<Grid, "header" | "rows">): string {
  return [grid.header, ...grid.rows].map((line) => line.map(field).join(",")).join("\r\n");
}
