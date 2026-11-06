// Table styles: the look a style gives each cell. This works the same rules out as the Rust side
// (`cell_look` in slides-core, which the export uses), so the editor and an exported file agree;
// the tests of both check the same cells. The styles are made of the theme's colours, so a table
// follows its theme when the theme changes.

import type { Fill, Stroke, TableStyle } from "@kasten-slides/wasm";

/** A theme colour at a strength from 0 to 1. */
type Tint = readonly [color: string, strength: number];
type Rules = "grid" | "horizontal" | "outer" | "nothing";

interface Preset {
  id: string;
  label: string;
  header?: Tint;
  /** The colour of the header's words, when its fill needs one. */
  headerText?: string;
  band?: Tint;
  first?: Tint;
  rules: Rules;
  rule: Tint;
}

const GRID: Tint = ["text2", 0.3];

/** The styles in the order a gallery shows them. Keep in step with `table_style.rs`. */
export const TABLE_STYLES: readonly Preset[] = [
  { id: "grid", label: "Plain grid", band: ["bg2", 0.6], rules: "grid", rule: GRID },
  { id: "accent", label: "Accent header", header: ["accent1", 1], headerText: "bg1", band: ["accent1", 0.1], first: ["accent1", 0.2], rules: "grid", rule: ["accent1", 0.3] },
  { id: "accent-light", label: "Soft accent", header: ["accent1", 0.25], band: ["accent1", 0.08], first: ["accent1", 0.12], rules: "horizontal", rule: ["accent1", 0.4] },
  { id: "dark", label: "Dark header", header: ["text1", 1], headerText: "bg1", band: ["bg2", 1], first: ["bg2", 1], rules: "horizontal", rule: GRID },
  { id: "rules", label: "Horizontal rules", rules: "horizontal", rule: ["text1", 0.6] },
  { id: "minimal", label: "Minimal", band: ["bg2", 0.7], rules: "nothing", rule: GRID },
  { id: "soft", label: "Soft bands", header: ["bg2", 1], band: ["bg2", 0.5], first: ["bg2", 1], rules: "nothing", rule: GRID },
  { id: "outline", label: "Outline", header: ["accent1", 0.15], first: ["accent1", 0.08], rules: "outer", rule: ["accent1", 0.8] },
  { id: "accent2", label: "Second accent", header: ["accent2", 1], headerText: "bg1", band: ["accent2", 0.1], first: ["accent2", 0.2], rules: "grid", rule: ["accent2", 0.3] },
  { id: "accent3", label: "Third accent", header: ["accent3", 1], headerText: "bg1", band: ["accent3", 0.1], first: ["accent3", 0.2], rules: "grid", rule: ["accent3", 0.3] },
];

/** What a style makes of one cell. A side that is undefined has no line. */
export interface CellLook {
  fill?: Fill;
  text?: string;
  bold: boolean;
  top?: Stroke;
  right?: Stroke;
  bottom?: Stroke;
  left?: Stroke;
}

const fillOf = ([color, strength]: Tint): Fill => (strength < 1 ? { color, alpha: strength } : { color });
const lineOf = ([color, strength]: Tint, width: number): Stroke => (strength < 1 ? { color, width, alpha: strength } : { color, width });

/** How a style looks on the cell at `row`, `col` of a table of `rows` by `cols`. The first row is the header only when `headerRow` says so. */
export function cellLook(style: TableStyle, headerRow: boolean, rows: number, cols: number, row: number, col: number): CellLook {
  const p = TABLE_STYLES.find((candidate) => candidate.id === style.preset) ?? TABLE_STYLES[0]!;
  const header = headerRow && row === 0;
  const last = Boolean(style.lastRow) && !header && row + 1 === rows;
  const first = Boolean(style.firstColumn) && !header && !last && col === 0;
  const dataRow = Math.max(0, row - (headerRow ? 1 : 0));
  const band = Boolean(style.bandedRows) && !header && !last && dataRow % 2 === 1;

  const look: CellLook = { bold: false };
  if (header) {
    if (p.header) look.fill = fillOf(p.header);
    if (p.headerText) look.text = p.headerText;
    look.bold = true;
  } else if (last) {
    look.bold = true;
  } else if (first) {
    if (p.first) look.fill = fillOf(p.first);
    look.bold = true;
  } else if (band && p.band) {
    look.fill = fillOf(p.band);
  }

  const thin = 1;
  if (p.rules === "grid") {
    look.top = look.right = look.bottom = look.left = lineOf(p.rule, thin);
  } else if (p.rules === "horizontal") {
    look.top = lineOf(p.rule, thin);
    look.bottom = lineOf(p.rule, header ? thin * 2 : thin);
  } else if (p.rules === "outer") {
    const edge = lineOf(p.rule, thin * 1.5);
    if (row === 0) look.top = edge;
    if (row + 1 === rows) look.bottom = edge;
    if (col === 0) look.left = edge;
    if (col + 1 === cols) look.right = edge;
    if (header) look.bottom = lineOf(p.rule, thin);
  }
  if (last && p.rules !== "grid") look.top = lineOf(["text1", 0.8], thin * 1.5);
  return look;
}
