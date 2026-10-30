// Reading a document's text for what completion and the outline need: the
// labels, and the headings. Pure functions over a string; the index (data.ts)
// decides when to run them (a moment after typing stops, for the file that
// changed).

export interface LabelInfo {
  key: string;
  /** The file it is in, relative to the document's folder. */
  file: string;
  line: number;
  /** The line it is on, trimmed: tells which equation or figure it is. */
  context: string;
}

export interface OutlineItem {
  /** 0 for `\part` to 6 for `\subparagraph`. */
  level: number;
  command: string;
  title: string;
  /** `\section*`: not numbered. */
  starred: boolean;
  line: number;
}

const LEVELS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];

/** The part of a line before an unescaped `%`. */
export function stripComment(line: string): string {
  if (!line.includes("%")) return line;
  const m = /(^|[^\\])%/.exec(line);
  return m ? line.slice(0, m.index + m[1]!.length) : line;
}

/** Every `\label{key}` outside comments. */
export function scanLabels(text: string, file: string): LabelInfo[] {
  const found: LabelInfo[] = [];
  if (!text.includes("\\label")) return found;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.includes("\\label")) continue;
    const line = stripComment(raw);
    for (const m of line.matchAll(/\\label\s*\{([^{}]+)\}/g)) {
      found.push({ key: m[1]!.trim(), file, line: i + 1, context: line.replace(/\\label\s*\{[^{}]*\}/g, "").trim().slice(0, 80) });
    }
  }
  return found;
}

/** The text inside the braces that start at `from` (the `{`), up to the matching `}` or the end of the line. */
function braced(line: string, from: number): string {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return line.slice(from + 1, i);
  }
  return line.slice(from + 1);
}

const HEADING = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/;

/** The headings of a document, `\part` to `\subparagraph`, in order. */
export function scanOutline(text: string): OutlineItem[] {
  const found: OutlineItem[] = [];
  if (!text.includes("\\")) return found;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.includes("\\") || !/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)/.test(raw)) continue;
    const line = stripComment(raw);
    const m = HEADING.exec(line);
    if (!m) continue;
    const title = braced(line, m[0].length - 1).replace(/\\(?:[A-Za-z]+\*?|.)\s*/g, (c) => (/^\\[A-Za-z]/.test(c) ? "" : c.slice(1))).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    found.push({ level: LEVELS.indexOf(m[1]!), command: m[1]!, title: title || `(${m[1]})`, starred: m[2] === "*", line: i + 1 });
  }
  return found;
}
