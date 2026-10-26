// Folding a LaTeX file by its headings: a `\section` folds away everything
// up to the next heading of the same or a higher level (or `\end{document}`),
// so a long paper can be read as an outline.

import { foldService } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";

const HEADING = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const END = /^\s*\\end\s*\{document\}/;

/** The level of the heading on this line (0 for `\part` … 6 for `\subparagraph`), or null. */
export function headingLevel(line: string): number | null {
  const match = HEADING.exec(line);
  return match ? (LEVELS[match[1]!] ?? null) : null;
}

/** What folds under the heading on line `n` (1-based): from the end of that line to the end of the last
 * non-blank line before the next heading of the same or a higher level. Null when the line is not a
 * heading or has nothing under it. */
export function foldUnder(doc: Text, n: number): { from: number; to: number } | null {
  const head = doc.line(n);
  const level = headingLevel(head.text);
  if (level === null) return null;
  let last = head.number;
  for (let at = head.number + 1; at <= doc.lines; at++) {
    const line = doc.line(at);
    const other = headingLevel(line.text);
    if ((other !== null && other <= level) || END.test(line.text)) break;
    if (line.text.trim() !== "") last = at;
  }
  const to = doc.line(last).to;
  return to > head.to ? { from: head.to, to } : null;
}

/** The fold service: headings fold (the editor's fold gutter and keys ask it). */
export const foldByHeading = foldService.of((state: EditorState, lineStart: number) => foldUnder(state.doc, state.doc.lineAt(lineStart).number));
