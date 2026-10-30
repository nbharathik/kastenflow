// Text pasted into a table, read as rows and cells. A block copied from a
// spreadsheet is tab separated; comma separated text is read as CSV only when
// it clearly is one (two or more lines that agree on their commas), so a
// sentence with a comma in it pastes whole. Quoted cells may hold the
// separator and line breaks; "" inside quotes is one quote; lines end with
// LF, CRLF or CR; a final empty line is dropped. Pure, table-tested.

type Rows = string[][];

/** Reads `text` as records of cells split at `sep`, quotes honoured. */
function read(text: string, sep: string): Rows {
  const rows: Rows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // Whether the record being read has any content yet (a character or a separator).
  let started = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      started = true;
    } else if (ch === sep) {
      started = true;
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      started = true;
      cell += ch;
    }
  }
  if (started || cell !== "") endRow();
  return rows;
}

/** The cells of a pasted block: rows of cells, raggedly as they came. */
export function parsePasted(raw: string): Rows {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (text === "") return [];
  const tabs = read(text, "\t");
  const rows = tabs.some((r) => r.length > 1) ? tabs : csvOrLines(text, tabs);
  // One empty cell is nothing to paste.
  return rows.length === 1 && rows[0]!.length === 1 && rows[0]![0] === "" ? [] : rows;
}

function csvOrLines(text: string, lines: Rows): Rows {
  const csv = read(text, ",");
  const width = csv[0]?.length ?? 0;
  return csv.length >= 2 && width >= 2 && csv.every((r) => r.length === width) ? csv : lines;
}
