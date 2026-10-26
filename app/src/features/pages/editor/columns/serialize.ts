// Writing a columns block back as text, keeping every byte that did not
// change. Pure string work: the marker lines and the whitespace around each
// column's blocks come from the block's original source; only the blocks
// themselves are written afresh (and those through the lossless layer, so a
// block nobody touched keeps its bytes too).

/** Equal widths are written with no numbers at all. */
const EQUAL = "";
const SEPARATOR_TEXT = "<!-- column -->";
const CLOSER_TEXT = "<!-- /columns -->";
/** The narrowest a column may be dragged to, in percent. */
export const MIN_SHARE = 10;

/** The widths a ratio stands for in `count` columns: its numbers, or equal widths
 * when it is empty, has another number of parts, or has a part that is not above zero. */
export function parseRatio(ratio: string, count: number): number[] {
  const equal = Array.from({ length: count }, () => 1);
  if (ratio === "") return equal;
  const parts = ratio.split("/").map(Number);
  return parts.length === count && parts.every((p) => Number.isFinite(p) && p > 0) ? parts : equal;
}

/** The ratio text for widths: nothing for equal ones. */
export function formatRatio(parts: readonly number[]): string {
  return parts.every((p) => p === parts[0]) ? EQUAL : parts.join("/");
}

/** The opening comment, as the editor writes it. */
export function openerText(ratio: string): string {
  return ratio === "" ? "<!-- columns -->" : `<!-- columns ${ratio} -->`;
}

/** The text of one column between its markers, split into the blank space around its blocks and the blocks. */
export interface Body {
  lead: string;
  core: string;
  trail: string;
}

/** A columns block's own source, taken apart. */
export interface OriginalColumns {
  opener: string;
  separators: string[];
  closer: string;
  bodies: Body[];
  ratio: string;
}

/** Takes `src`, whose markers stand at `marks` (opener, separators, closer), apart. */
export function splitSource(src: string, marks: readonly { start: number; end: number }[]): OriginalColumns | null {
  if (marks.length < 2) return null;
  const text = (i: number) => src.slice(marks[i]!.start, marks[i]!.end);
  const bodies: Body[] = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const raw = src.slice(marks[i]!.end, marks[i + 1]!.start);
    const core = raw.trim();
    if (core === "") {
      bodies.push({ lead: raw, core: "", trail: "" });
      continue;
    }
    bodies.push({ lead: raw.slice(0, raw.indexOf(core)), core, trail: raw.slice(raw.indexOf(core) + core.length) });
  }
  const opener = text(0);
  return {
    opener,
    separators: marks.slice(1, -1).map((_, i) => text(i + 1)),
    closer: text(marks.length - 1),
    bodies,
    ratio: (/columns\s+(\d+(?:\s*\/\s*\d+)*)/i.exec(opener)?.[1] ?? "").replace(/\s+/g, ""),
  };
}

const BLANK = "\n\n";

/**
 * The block's text: markers and spacing from `original` where there is one
 * (the opener only while the ratio is the one it already says), and
 * `cores[i]` as column i's blocks, which are already written. A column that
 * had no blocks and now has some, or the reverse, gets a blank line around them.
 */
export function composeColumns(original: OriginalColumns | null, ratio: string, cores: readonly string[]): string {
  const out: string[] = [original && original.ratio === ratio ? original.opener : openerText(ratio)];
  cores.forEach((core, i) => {
    const before = original?.bodies[i];
    if (core === "") out.push(before && before.core === "" ? before.lead : BLANK);
    else out.push((before && before.core !== "" ? before.lead : BLANK) + core + (before && before.core !== "" ? before.trail : BLANK));
    out.push(i < cores.length - 1 ? (original?.separators[i] ?? SEPARATOR_TEXT) : (original?.closer ?? CLOSER_TEXT));
  });
  return out.join("");
}
