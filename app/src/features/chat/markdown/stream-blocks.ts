// An answer's blocks while it streams. Text only grows at its end, and a
// block only looks ahead a line or two, so the blocks well before the end
// stay as they were: each frame reads from the last blocks on, not the whole
// answer again. The result is exactly what reading the whole text gives.

import { spansFrom, splitLines, type SourcedBlock, type Span } from "./blocks";

export interface Parsed {
  text: string;
  lines: string[];
  spans: Span[];
}

/** The blocks of `text`, reusing those of `prev` (the same answer a frame earlier) that the new text cannot change. */
export function parseMore(prev: Parsed | null, text: string): Parsed {
  const lines = splitLines(text);
  // Anything but text grown at its end (or a "\r" that may join a "\n" after it) is read afresh.
  if (!prev || prev.text.length === 0 || !text.startsWith(prev.text) || prev.text.endsWith("\r")) return { text, lines, spans: spansFrom(lines, 0) };
  // Only the old last line can differ; a block looks ahead to the first line of the one after it, and one line more.
  const settled = prev.lines.length - 1;
  let keep = 0;
  while (keep + 1 < prev.spans.length && prev.spans[keep + 1]!.start + 2 <= settled) keep++;
  const from = prev.spans[keep]?.start ?? 0;
  return { text, lines, spans: [...prev.spans.slice(0, keep), ...spansFrom(lines, from)] };
}

export const blocksOfParsed = (parsed: Parsed): SourcedBlock[] => parsed.spans.map((span) => span.block);
