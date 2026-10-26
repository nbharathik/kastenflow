// The lines of a Markdown (GFM) table, read as text: where each cell's bytes
// are, so a change can touch the cells it must and leave the rest alone.

export type Align = "left" | "center" | "right" | null;

export interface Cell {
  /** The cell's raw bytes (spaces included) are `line.slice(start, end)`. */
  start: number;
  end: number;
  /** The cell without the spaces around it. */
  text: string;
}

export interface Row {
  cells: Cell[];
  /** Whether the line begins and ends with a pipe. */
  leading: boolean;
  trailing: boolean;
}

/** Splits a table line at its unescaped pipes. */
export function splitRow(line: string): Row {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") pipes.push(i);
  }
  if (pipes.length === 0) return { cells: [cellOf(line, 0, line.length)], leading: false, trailing: false };
  const cuts = [-1, ...pipes, line.length];
  const cells: Cell[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) cells.push(cellOf(line, cuts[i]! + 1, cuts[i + 1]!));
  const leading = line.slice(0, pipes[0]).trim() === "";
  const trailing = line.slice(pipes[pipes.length - 1]! + 1).trim() === "";
  if (trailing) cells.pop();
  if (leading) cells.shift();
  return { cells, leading, trailing };
}

function cellOf(line: string, start: number, end: number): Cell {
  return { start, end, text: line.slice(start, end).trim() };
}

/** `:---:`, `---:`, `:---` or `---`, as a delimiter row cell; null for any other text. */
export function alignOf(text: string): Align | undefined {
  if (!/^:?-+:?$/.test(text)) return undefined;
  const left = text.startsWith(":");
  const right = text.endsWith(":");
  return left && right ? "center" : left ? "left" : right ? "right" : null;
}

/** A delimiter cell for `align`, `width` characters wide (never fewer than three). */
export function delimiterCell(align: Align, width: number): string {
  const w = Math.max(3, width);
  if (align === "center") return `:${"-".repeat(w - 2)}:`;
  if (align === "left") return `:${"-".repeat(w - 1)}`;
  if (align === "right") return `${"-".repeat(w - 1)}:`;
  return "-".repeat(w);
}

/** Whether `line` is a delimiter row: every cell is dashes with optional colons. */
export function isDelimiterRow(line: string): boolean {
  const { cells } = splitRow(line);
  return cells.length > 0 && cells.every((c) => alignOf(c.text) !== undefined) && line.includes("-");
}

/** A line of `cells` in the style (outer pipes or not) of `like`. */
export function buildLine(cells: readonly string[], like: Row): string {
  const body = cells.join(" | ");
  // A single cell with no pipes would not be a table at all.
  const bare = cells.length === 1 && !like.leading && !like.trailing;
  return `${like.leading || bare ? "| " : ""}${body}${like.trailing || bare ? " |" : ""}`;
}
