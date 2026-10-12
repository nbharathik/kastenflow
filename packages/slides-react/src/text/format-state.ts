// How the selected text is formatted, for a toolbar: each setting has one
// value when everything selected agrees on it, and "mixed" when it does not.

import type { Align, ListKind, ListStyle, Script, TextFit, TextStyle } from "@kasten-slides/wasm";
import type { Mark } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";

import { marksOfLook } from "./convert.ts";
import { placesOf } from "./list-commands.ts";
import { styleOf } from "./lists.ts";
import { lookOfMark, paragraphOfAttrs } from "./paragraph-attrs.ts";
import { type EditorContext, caretMarks, markRange, selectedEmptyParagraphs, selectedParagraphs, selectedPieces, styleOfNode } from "./selection-info.ts";
import { type TextSchema, attrsOf } from "./schema.ts";
import { resolveAlign, textStyleOf } from "./text-style.ts";

/** A yes, a no, or a selection that holds both. */
export type Tri = boolean | "mixed";

/**
 * `null` means the setting is not overridden: the text style's own value
 * applies. `bold` and `italic` are what the text shows, so they are on in a
 * bold title even though no run says so; `align` is likewise the alignment
 * shown.
 */
export interface FormatState {
  bold: Tri;
  italic: Tri;
  underline: Tri;
  strike: Tri;
  code: Tri;
  color: string | "mixed" | null;
  size: number | "mixed" | null;
  font: string | "mixed" | null;
  align: Align | "mixed";
  list: ListKind | "mixed" | null;
  /** The level of the first paragraph selected. */
  level: number;
  link: string | "mixed" | null;
  lineSpacing: number | "mixed" | null;
  /** Raised or lowered words. */
  script: Script | "mixed" | null;
  smallCaps: Tri;
  allCaps: Tri;
  /** Extra space between letters, in points. */
  spacing: number | "mixed" | null;
  /** The style of the marker the selected list items show (null when none of them is a list item). */
  listStyle: ListStyle | "mixed" | null;
  /** The number the first selected numbered item is told to begin at, or null when it goes on from the items above. */
  start: number | null;
  /** The marker's own colour (a token or hex); null where it takes the colour of its words. */
  bulletColor: string | "mixed" | null;
  /** The marker's size as a multiple of its words' size (1.5 is 150%); null where it is the words' size. */
  bulletSize: number | "mixed" | null;
  /** Points of space before and after the paragraphs; null leaves it to the text style. */
  spaceBefore: number | "mixed" | null;
  spaceAfter: number | "mixed" | null;
  /** Where the words of the paragraphs start after the first line, and where the first line starts from there, in slide units as they are drawn. */
  marginLeft: number | "mixed";
  indent: number | "mixed";
  /** What the box does when its words do not fit. */
  fit: TextFit;
  /** Whether lines wrap at the box's edge. */
  wrap: boolean;
}

/** One stretch of the selection: the marks its text has, and the text style it is set in. */
interface Sample {
  marks: readonly Mark[];
  style: TextStyle;
}

function samplesOf(state: EditorState, ctx: EditorContext): Sample[] {
  const schema = state.schema as TextSchema;
  const first = selectedParagraphs(state)[0]?.node;
  const caret = (): Sample[] => [{ marks: caretMarks(state), style: first ? styleOfNode(ctx, first) : textStyleOf(ctx.theme, ctx.baseStyle) }];
  // A caret: what text typed here would get.
  if (state.selection.empty) return caret();
  const samples = selectedPieces(state).map((piece) => ({ marks: piece.text.marks, style: styleOfNode(ctx, piece.paragraph) }));
  if (samples.length > 0) return samples;
  // A selection of empty paragraphs: the look each one gives the words typed into it.
  const empty = selectedEmptyParagraphs(state).map(({ node }) => ({ marks: marksOfLook(schema, lookOfMark(attrsOf(node).mark)), style: styleOfNode(ctx, node) }));
  return empty.length > 0 ? empty : caret();
}

const has = (sample: Sample, name: string): boolean => sample.marks.some((mark) => mark.type.name === name);

function valueOf(sample: Sample, name: string, key: string): unknown {
  return sample.marks.find((mark) => mark.type.name === name)?.attrs[key];
}

const textOf = (sample: Sample, name: string, key: string): string | null => {
  const value = valueOf(sample, name, key);
  return typeof value === "string" && value !== "" ? value : null;
};

/** The one value they all have, or "mixed". */
function agree<T>(values: readonly T[], none: T): T | "mixed" {
  const [first] = values;
  if (values.length === 0) return none;
  return values.every((value) => value === first) ? (first as T) : "mixed";
}

export function formatStateOf(state: EditorState, ctx: EditorContext): FormatState {
  const samples = samplesOf(state, ctx);
  const picked = selectedParagraphs(state);
  const attrs = picked.map((located) => attrsOf(located.node));
  // Where the selected paragraphs set their lines depends on the list they are in, so it is worked out for all of them.
  const places: ReturnType<typeof placesOf> = attrs.some((a) => a.list !== null || a.marginLeft !== null || a.indent !== null || a.level !== null)
    ? (() => {
        const starts = new Map<number, number>();
        state.doc.forEach((_node, pos) => starts.set(pos, starts.size));
        const all = placesOf(state, ctx);
        return picked.map(({ pos }) => all[starts.get(pos) ?? 0] ?? { margin: 0, indent: 0 });
      })()
    : picked.map(() => ({ margin: 0, indent: 0 }));
  return {
    bold: agree(samples.map((s) => has(s, "bold") || Boolean(s.style.bold)), false),
    italic: agree(samples.map((s) => has(s, "italic") || Boolean(s.style.italic)), false),
    underline: agree(samples.map((s) => has(s, "underline")), false),
    strike: agree(samples.map((s) => has(s, "strike")), false),
    code: agree(samples.map((s) => has(s, "code")), false),
    color: agree(samples.map((s) => textOf(s, "color", "value")), null),
    size: agree(
      samples.map((s) => {
        const size = valueOf(s, "size", "value");
        return typeof size === "number" && size > 0 ? size : null;
      }),
      null,
    ),
    font: agree(samples.map((s) => textOf(s, "font", "value")), null),
    align: agree(attrs.map((a) => resolveAlign(ctx.theme, ctx.baseStyle, a)), "left" as Align),
    list: agree(attrs.map((a) => a.list), null),
    level: attrs[0]?.level ?? 0,
    link: agree(samples.map((s) => textOf(s, "link", "href")), null),
    lineSpacing: agree(attrs.map((a) => a.lineSpacing), null),
    script: agree(
      samples.map((s) => {
        const value = valueOf(s, "script", "value");
        return value === "super" || value === "sub" ? value : null;
      }),
      null,
    ),
    smallCaps: agree(samples.map((s) => has(s, "smallCaps")), false),
    allCaps: agree(samples.map((s) => has(s, "allCaps")), false),
    spacing: agree(
      samples.map((s) => {
        const value = valueOf(s, "spacing", "value");
        return typeof value === "number" && value !== 0 ? value : null;
      }),
      null,
    ),
    listStyle: agree(attrs.map((a) => styleOf(paragraphOfAttrs(a))), null),
    start: attrs[0]?.start ?? null,
    bulletColor: agree(attrs.filter((a) => a.list !== null).map((a) => a.bulletColor), null),
    bulletSize: agree(attrs.filter((a) => a.list !== null).map((a) => a.bulletSize), null),
    spaceBefore: agree(attrs.map((a) => a.spaceBefore), null),
    spaceAfter: agree(attrs.map((a) => a.spaceAfter), null),
    marginLeft: agree(places.map((g) => g.margin), 0),
    indent: agree(places.map((g) => g.indent), 0),
    fit: "none",
    wrap: true,
  };
}

/** The address of the link the selection is in, or that the caret touches; null when there is none or the selection holds several. */
export function linkAtSelection(state: EditorState): string | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  if (state.selection.empty) {
    const href: unknown = markRange(state.selection.$from, type)?.mark.attrs.href;
    return typeof href === "string" ? href : null;
  }
  const hrefs = selectedPieces(state).map((piece) => {
    const value: unknown = type.isInSet(piece.text.marks)?.attrs.href;
    return typeof value === "string" ? value : null;
  });
  const first = hrefs[0];
  return first !== undefined && hrefs.every((href) => href === first) ? first : null;
}
