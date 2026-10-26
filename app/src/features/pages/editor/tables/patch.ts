// A table the editor changed, written so that what was not changed keeps its
// bytes. The editor's serializer pads every cell of a table it writes; this
// takes the canonical text only as the answer to "what should the table say"
// and edits the original lines to say it: a column's alignment changes the
// delimiter row and nothing else, a row added is one new line, a column added
// puts one cell at the end of each line. Anything it cannot place cell by cell
// it writes the way the serializer does.

import { alignSequences } from "../../markdown/align";
import { alignOf, buildLine, delimiterCell, isDelimiterRow, splitRow, type Cell, type Row } from "./cells";

type Same = (was: string, now: string) => boolean;
/** The cell text to write for `now`; `was` is the cell it replaces, if any. */
type Place = (was: string | undefined, now: string) => string;

const sameText: Same = (a, b) => a === b;
const asIs: Place = (_was, now) => now;

const sameAlignment: Same = (a, b) => alignOf(a) === alignOf(b);
/** A delimiter cell as wide as the one it replaces, so the column stays as it looked. */
const delimiter: Place = (was, now) => delimiterCell(alignOf(now) ?? null, was?.length ?? 3);

/** Replaces a cell's text and keeps the spaces around it. */
function replaceCell(line: string, cell: Cell, text: string): string {
  const raw = line.slice(cell.start, cell.end);
  const padded = raw.trim() === "" ? ` ${text} ` : raw.slice(0, raw.length - raw.trimStart().length) + text + raw.slice(raw.trimEnd().length);
  return line.slice(0, cell.start) + padded + line.slice(cell.end);
}

/** `line` made to say `next`, changing only the cells that differ when it can. */
function rewrite(line: string, next: readonly string[], same: Same, place: Place): string {
  const row = splitRow(line);
  const old = row.cells;
  const common = Math.min(old.length, next.length);
  const prefixSame = old.slice(0, common).every((c, i) => same(c.text, next[i]!));
  const end = line.trimEnd().length;

  if (old.length === next.length) {
    let out = line;
    for (let i = common - 1; i >= 0; i--) {
      if (!same(old[i]!.text, next[i]!)) out = replaceCell(out, old[i]!, place(old[i]!.text, next[i]!));
    }
    return out;
  }
  if (next.length > old.length && prefixSame) {
    const extra = next.slice(old.length).map((t) => place(undefined, t));
    return line.slice(0, end) + extra.map((x) => (row.trailing ? ` ${x} |` : ` | ${x}`)).join("") + line.slice(end);
  }
  if (next.length < old.length && next.length > 0 && prefixSame) {
    const cut = line.slice(0, old[next.length - 1]!.end);
    return row.trailing ? `${cut}|${line.slice(end)}` : cut.trimEnd() + line.slice(end);
  }
  return buildLine(next.map((t) => place(undefined, t)), row);
}

const textsOf = (row: Row) => row.cells.map((c) => c.text);
const sameRow = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** The body rows, one line each, old lines kept where the row is the same. */
function bodyRows(was: readonly string[], nowCells: readonly string[][], like: Row, sameColumns: boolean): string[] {
  const wasCells = was.map((l) => textsOf(splitRow(l)));
  const lines = new Map<number, string>();
  if (sameColumns) {
    const match = alignSequences(wasCells, nowCells, sameRow);
    match.forEach((j, i) => {
      if (j >= 0) lines.set(j, was[i]!);
    });
    // Rows that changed in place keep their line and change their cells.
    const left = was.map((_, i) => i).filter((i) => match[i] === -1);
    const added = nowCells.map((_, j) => j).filter((j) => !lines.has(j));
    if (left.length === added.length) left.forEach((i, k) => lines.set(added[k]!, rewrite(was[i]!, nowCells[added[k]!]!, sameText, asIs)));
  } else {
    nowCells.forEach((cells, j) => {
      if (j < was.length) lines.set(j, rewrite(was[j]!, cells, sameText, asIs));
    });
  }
  return nowCells.map((cells, j) => lines.get(j) ?? buildLine(cells, like));
}

/** What the serializer writes for a cell with nothing in it. */
const EMPTY_CELL = "<br />";

/**
 * The original table text changed to say what `canonical` says, or null when
 * either is not a table. Lines are separated by `\n` (the caller maps line ends).
 * With `emptyCells`, a cell the serializer wrote as `<br />` is written empty.
 */
export function patchTable(original: string, canonical: string, emptyCells = false): string | null {
  const was = original.split("\n");
  const now = canonical.split("\n");
  if (was.length < 2 || now.length < 2 || !isDelimiterRow(was[1]!) || !isDelimiterRow(now[1]!)) return null;
  const textsNow = (line: string) => textsOf(splitRow(line)).map((t) => (emptyCells && t === EMPTY_CELL ? "" : t));
  const head = splitRow(was[0]!);
  const headNow = textsNow(now[0]!);
  const sameColumns = head.cells.length === headNow.length;
  const lines = [
    rewrite(was[0]!, headNow, sameText, asIs),
    rewrite(was[1]!, textsOf(splitRow(now[1]!)), sameAlignment, delimiter),
    ...bodyRows(was.slice(2), now.slice(2).map(textsNow), head, sameColumns),
  ];
  return lines.join("\n");
}
