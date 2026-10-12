// The measurements text is drawn with. The PPTX writer uses the same numbers,
// so a deck reads the same in the editor, when presenting and in PowerPoint.

/** Space between a box's edge and its text when the text names none: 0.1 in across, 0.05 in down. */
export const DEFAULT_INSETS = { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 } as const;

/** The room a list marker has in front of its text, in slide units, unless it needs more; its text starts this far in from the left inset. */
export const LIST_INDENT = 24;

/** Each level of a paragraph that is not a list item moves this far further in. */
export const LIST_STEP = 24;

/** The air between a marker and its text, as a share of the marker's size. */
export const AIR = 0.35;

/** Marker rooms grow in steps of this many units, so they stay near the usual ones. */
export const HANG_STEP = 6;

/** The most that any list grows: a marker as big as a heading is not given more room than this. */
export const MOST_HANGING = 240;

/** The line height as a multiple of the type size when a paragraph and its style name none. */
export const DEFAULT_LINE_SPACING = 1;

/** The glyph each bullet style shows. */
export const BULLET_GLYPHS = { disc: "●", circle: "○", square: "■", arrow: "➢", check: "✓", dash: "–" } as const;

/** A line break inside a run. PowerPoint writes it as `<a:br/>`. */
export const LINE_BREAK = "\n";

/** Superscript and subscript are set at this share of the type size, as PowerPoint sets them. */
export const SCRIPT_SIZE = 0.65;

/** How far a raised or lowered run moves, as a share of the size of the line's type (PowerPoint's 30% and 25%). */
export const SCRIPT_RAISE = { super: 0.3, sub: 0.25 } as const;

/** How far a raised or lowered run is moved, as CSS: a share of its own (smaller) size, which makes the share of the line's type above. */
export function scriptTop(script: "super" | "sub"): string {
  const shift = script === "super" ? -SCRIPT_RAISE.super / SCRIPT_SIZE : SCRIPT_RAISE.sub / SCRIPT_SIZE;
  return `${Math.round(shift * 10000) / 10000}em`;
}

/** The least that "shrink text on overflow" sets type to, as a share of its size. */
export const MIN_FIT_SCALE = 0.5;
