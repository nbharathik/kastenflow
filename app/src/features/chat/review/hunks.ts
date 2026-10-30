// The hunks of a proposed text change: each run of changed lines (a few
// kept lines around it for reading), and the text that results when the
// person keeps some and undoes others. Pure, so the rules are easy to test.
// Nothing is written here: the chosen text goes to the core's
// `acceptProposalHunks`, which merges it with edits made since.

import { diffLines, type DiffLine } from "../../review/diff";

export interface Hunk {
  /** Its order among the hunks, from 0. */
  index: number;
  /** The changed lines with up to `CONTEXT` kept lines either side, for drawing. */
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Kept lines drawn either side of a hunk. */
const CONTEXT = 1;

/** The hunks of the change from `before` to `after`, and the diff they come from. */
export function hunksOf(before: string | null, after: string | null): { lines: DiffLine[]; hunks: Hunk[] } {
  const lines = diffLines(before, after);
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind === "same") {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i]!.kind !== "same") i++;
    const run = lines.slice(start, i);
    hunks.push({
      index: hunks.length,
      lines: [...lines.slice(Math.max(0, start - CONTEXT), start), ...run, ...lines.slice(i, i + CONTEXT)],
      added: run.filter((l) => l.kind === "add").length,
      removed: run.filter((l) => l.kind === "del").length,
    });
  }
  return { lines, hunks };
}

const endOf = (text: string | null) => (text?.endsWith("\n") ? (text.endsWith("\r\n") ? "\r\n" : "\n") : "");

/** The text with the hunks in `undone` left as they were before: every other
 * change is kept. With nothing undone this is `after` itself, byte for byte. */
export function textKeeping(before: string | null, after: string | null, undone: ReadonlySet<number>): string {
  if (undone.size === 0) return after ?? "";
  const { lines } = hunksOf(before, after);
  const eol = (before ?? "").includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  let hunk = -1;
  let inRun = false;
  let last: DiffLine | null = null;
  for (const line of lines) {
    if (line.kind === "same") {
      inRun = false;
      out.push(line.text);
      last = line;
      continue;
    }
    if (!inRun) {
      hunk++;
      inRun = true;
    }
    const gone = undone.has(hunk);
    // An undone hunk gives back the old lines; a kept one has the new.
    if ((gone && line.kind === "del") || (!gone && line.kind === "add")) {
      out.push(line.text);
      last = line;
    }
  }
  if (out.length === 0 || !last) return "";
  // The text ends the way the text its last line came from does.
  const newCount = lines.filter((l) => l.b !== undefined).length;
  const fromAfter = last.kind === "add" || (last.kind === "same" && last.b === newCount);
  return out.join(eol) + endOf(fromAfter ? after : before);
}
