// Cells on the clipboard. A copy of cells writes two things: tab separated text (what a spreadsheet or a text editor takes) and a table in
// HTML that also carries the cells' own words and looks in an attribute only Kasten reads. A paste takes the best it finds: those cells,
// then a table from HTML (a spreadsheet's or a web page's: its words and its spans, nothing else), then rows of text with Excel's quoting.
// Pasted HTML is read as an inert document and only its text is kept, so nothing in it can run or end up in a cell as markup.

import type { Text } from "@kasten-slides/wasm";

import { MOST_COLUMNS, MOST_PLACES } from "../../render/table-layout.ts";
import { type ClipContents, type DataLike, fromBase64, toBase64 } from "./format.ts";

/** The attribute on the HTML table of a copy that carries the cells' own words and looks. */
const ATTRIBUTE = "data-kasten-cells";

// ---- rows of text

/**
 * Splits text into rows of cells at `delimiter`, as Excel does: a cell that starts with a quote runs to the closing quote, whatever it holds
 * (tabs, line breaks), and a doubled quote in it is one quote. A quote anywhere else is just a quote. A line break ends a row, however it is
 * written, and the one at the end of the text does not make another.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  const endField = (): void => {
    row.push(field);
    field = "";
    started = false;
  };
  for (let at = 0; at < text.length; at++) {
    const char = text[at] as string;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[at + 1] === '"') {
        field += '"';
        at++;
      } else quoted = false;
    } else if (char === '"' && !started) {
      quoted = true;
      started = true;
    } else if (char === delimiter) endField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at++;
      endField();
      rows.push(row);
      row = [];
    } else {
      field += char;
      started = true;
    }
  }
  if (started || field !== "" || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows;
}

/**
 * How the cells of a text are separated: a tab, whenever there is one (what a spreadsheet copies); a comma only when the text is several
 * lines that all come to the same number of cells, two or more (a file of comma separated values), so a sentence is not cut at its commas.
 * Null for text that is just lines.
 */
export function detectDelimiter(text: string): "\t" | "," | null {
  if (text.includes("\t")) return "\t";
  if (!text.includes(",")) return null;
  const rows = parseDelimited(text, ",").filter((row) => row.length > 1 || row[0] !== "");
  const width = rows[0]?.length ?? 0;
  return rows.length >= 2 && width >= 2 && rows.every((row) => row.length === width) ? "," : null;
}

/** The rows of cells a text makes. */
export function rowsOfText(text: string): string[][] {
  if (text.trim() === "") return [];
  const delimiter = detectDelimiter(text);
  if (delimiter) return parseDelimited(text, delimiter);
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => [line]);
}

/** Tab separated text for rows of cells: a cell with a tab, a line break or a quote in it is quoted, with its quotes doubled. */
export function tsvOfRows(rows: readonly (readonly string[])[]): string {
  const cell = (value: string): string => (/[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return rows.map((row) => row.map(cell).join("\t")).join("\r\n");
}

// ---- the words of cells

/** The words of a cell: a line to a paragraph. */
export function wordsOfCell(text: Text): string {
  return text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.t).join("")).join("\n");
}

export const rowsOfTexts = (texts: readonly (readonly Text[])[]): string[][] => texts.map((row) => row.map(wordsOfCell));

/** A cell's text from words: a paragraph to a line, and one empty paragraph for none. */
export const textOfWords = (words: string): Text => ({ paragraphs: words.split("\n").map((line) => ({ runs: [{ t: line }] })) });

export const textsOfRows = (rows: readonly (readonly string[])[]): Text[][] => rows.map((row) => row.map(textOfWords));

// ---- HTML

const SKIPPED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE"]);

/** The words of one cell of an HTML table: its text, a line to a break or a block, runs of white space (a no-break space too) as one space. */
function wordsOfNode(cell: Element): string {
  const lines = [""];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      lines[lines.length - 1] += (node.textContent ?? "").replace(/\s+/g, " ");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (SKIPPED.has(element.tagName)) return;
    const block = BLOCKS.has(element.tagName);
    if (element.tagName === "BR" || block) lines.push("");
    element.childNodes.forEach(walk);
    if (block) lines.push("");
  };
  cell.childNodes.forEach(walk);
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** A span attribute as a count: at least 1, at most `most`; a missing or odd one is 1. */
function spanOf(value: string | null, most: number): number {
  const count = Number.parseInt(value ?? "", 10);
  return Number.isFinite(count) && count > 1 ? Math.min(count, most) : 1;
}

/**
 * The first table of some HTML as rows of words. A cell that spans leaves the places it covers empty, and the cells after it go past them, as
 * a browser lays them out. Only the words are kept: markup, styles, scripts and handlers are dropped. Null when there is no table.
 */
export function rowsOfHtml(html: string): string[][] | null {
  if (!/<t(?:able|r|d|h)[\s>/]/i.test(html)) return null;
  const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  if (!table) return null;
  const sourceRows = Array.from(table.rows);
  const taken = new Set<number>();
  let budget = MOST_PLACES;
  const grid: string[][] = [];
  sourceRows.forEach((source, r) => {
    const row = (grid[r] ??= []);
    let col = 0;
    for (const cell of Array.from(source.cells)) {
      while (taken.has(r * MOST_COLUMNS + col)) col++;
      if (col >= MOST_COLUMNS) break;
      const colSpan = Math.min(spanOf(cell.getAttribute("colspan"), MOST_COLUMNS), MOST_COLUMNS - col);
      const rowSpan = Math.min(spanOf(cell.getAttribute("rowspan"), sourceRows.length - r), sourceRows.length - r);
      row[col] = wordsOfNode(cell);
      // A span marks the places it covers; one big enough to cost more than a table may hold is not marked past that.
      for (let dr = 0; dr < rowSpan && budget > 0; dr++) {
        for (let dc = 0; dc < colSpan && budget > 0; dc++) {
          if (dr === 0 && dc === 0) continue;
          taken.add((r + dr) * MOST_COLUMNS + col + dc);
          budget--;
        }
      }
      col += colSpan;
    }
  });
  const width = Math.min(Math.max(0, ...grid.map((row) => row.length)), MOST_COLUMNS);
  return grid.map((row) => Array.from({ length: width }, (_, at) => row[at] ?? ""));
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The HTML of a copy of cells: a table of their words, with their own words and looks in an attribute. */
export function htmlOfCells(texts: readonly (readonly Text[])[]): string {
  const rows = texts.map((row) => `<tr>${row.map((cell) => `<td>${wordsOfCell(cell).split("\n").map(escapeHtml).join("<br>")}</td>`).join("")}</tr>`);
  return `<table ${ATTRIBUTE}="${toBase64(JSON.stringify(texts))}"><tbody>${rows.join("")}</tbody></table>`;
}

const isText = (value: unknown): value is Text => typeof value === "object" && value !== null && Array.isArray((value as { paragraphs?: unknown }).paragraphs);

/** The cells a copy of Kasten's carries in its HTML, if it is one: rows of texts. Null for anything else, a damaged attribute included. */
export function textsOfHtml(html: string | null | undefined): Text[][] | null {
  const found = html ? new RegExp(`${ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(html)?.[1] : undefined;
  if (!found) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64(found));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.every((row) => Array.isArray(row) && row.every(isText)) ? (parsed as Text[][]) : null;
  } catch {
    return null;
  }
}

// ---- the clipboard

/** Puts a copy of cells on the data of a copy or cut event: the words as tab separated text, and the table. */
export function writeCells(data: Required<Pick<DataLike, "setData">>, texts: readonly (readonly Text[])[]): void {
  data.setData("text/html", htmlOfCells(texts));
  data.setData("text/plain", tsvOfRows(rowsOfTexts(texts)));
}

/** The cells a paste is made of: those Kasten copied, else a table in HTML, else rows of text. Null when the clipboard holds none of them. */
export function cellsFromContents(contents: Pick<ClipContents, "html" | "text">): Text[][] | null {
  const own = textsOfHtml(contents.html);
  if (own) return own;
  const table = rowsOfHtml(contents.html);
  if (table && table.length > 0) return textsOfRows(table);
  const rows = rowsOfText(contents.text);
  return rows.length > 0 ? textsOfRows(rows) : null;
}
