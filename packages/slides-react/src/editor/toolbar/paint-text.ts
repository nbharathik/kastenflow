// The words of the paint format brush: how a stretch of text looks as a brush, and a brush laid on a text. Shared by the boxes (paint.ts) and
// the cells of a table (table/paint.ts).

import type { Align, ListStyle, Run, Text, Theme } from "@kasten-slides/wasm";

import { type Command, runOnText, setAlign, setBulletColor, setBulletSize, setLineSpacing, setList, setParagraphSpacing } from "../../text/commands.ts";
import type { FormatState } from "../../text/format-state.ts";
import type { EditorContext } from "../../text/selection-info.ts";
import type { PaintFormat } from "../ui-state.ts";

/** A yes or a no; undefined where the selection holds both. */
const flag = (value: boolean | "mixed"): boolean | undefined => (value === "mixed" ? undefined : value);

/** How the paragraphs in hand are set, for the settings they all agree on. */
function paragraphOf(format: FormatState): NonNullable<PaintFormat["paragraph"]> {
  const set: NonNullable<PaintFormat["paragraph"]> = {};
  if (format.align !== "mixed") set.align = format.align;
  if (format.lineSpacing !== "mixed") set.lineSpacing = format.lineSpacing;
  if (format.spaceBefore !== "mixed") set.spaceBefore = format.spaceBefore;
  if (format.spaceAfter !== "mixed") set.spaceAfter = format.spaceAfter;
  if (format.list !== "mixed") {
    set.list = format.list;
    if (format.listStyle !== "mixed") set.listStyle = format.listStyle;
    if (format.bulletColor !== "mixed") set.bulletColor = format.bulletColor;
    if (format.bulletSize !== "mixed") set.bulletSize = format.bulletSize;
  }
  return set;
}

/** The brush a text's formatting makes: the looks of the words, and how the paragraphs are set, for the settings the text agrees on. */
export function brushOf(format: FormatState): Pick<PaintFormat, "run" | "paragraph"> {
  const run: PaintFormat["run"] = {};
  for (const [key, value] of [["b", flag(format.bold)], ["i", flag(format.italic)], ["u", flag(format.underline)], ["s", flag(format.strike)]] as const) {
    if (value !== undefined) run[key] = value;
  }
  if (typeof format.color === "string" && format.color !== "mixed") run.color = format.color;
  if (format.highlight !== "mixed") run.highlight = format.highlight;
  if (typeof format.size === "number") run.size = format.size;
  if (typeof format.font === "string" && format.font !== "mixed") run.font = format.font;
  if (format.script !== "mixed") run.script = format.script;
  for (const [key, value] of [["smallCaps", flag(format.smallCaps)], ["allCaps", flag(format.allCaps)]] as const) {
    if (value !== undefined) run[key] = value;
  }
  if (format.spacing !== "mixed") run.spacing = format.spacing;
  const paragraph = paragraphOf(format);
  return { run, ...(Object.keys(paragraph).length > 0 ? { paragraph } : {}) };
}

/** The runs with what the brush carries laid over: a flag it lacks is taken off, colour, size and font it lacks go back to the text style's. */
export function paintRuns(text: Text, run: PaintFormat["run"]): Text {
  const paint = (old: Run): Run => {
    const { b, i, u, s, color: _color, highlight, size: _size, font: _font, script, smallCaps, allCaps, spacing, ...rest } = old;
    const keep = (name: "b" | "i" | "u" | "s", was: boolean | undefined) => {
      const now = run[name] === undefined ? was : run[name];
      return now ? { [name]: true } : {};
    };
    const raised = run.script === undefined ? script : run.script;
    const gap = run.spacing === undefined ? spacing : run.spacing;
    const marked = run.highlight === undefined ? highlight : run.highlight;
    return {
      ...rest,
      ...keep("b", b),
      ...keep("i", i),
      ...keep("u", u),
      ...keep("s", s),
      ...(run.color ? { color: run.color } : {}),
      ...(marked ? { highlight: marked } : {}),
      ...(run.size ? { size: run.size } : {}),
      ...(run.font ? { font: run.font } : {}),
      ...(raised ? { script: raised } : {}),
      ...((run.smallCaps === undefined ? smallCaps : run.smallCaps) ? { smallCaps: true } : {}),
      ...((run.allCaps === undefined ? allCaps : run.allCaps) ? { allCaps: true } : {}),
      ...(gap ? { spacing: gap } : {}),
    };
  };
  return { ...text, paragraphs: text.paragraphs.map((p) => ({ ...p, runs: p.runs.map(paint) })) };
}

/**
 * The paragraphs set as the brush's: each setting it carries goes on every paragraph by the commands the text editor uses (so a list is
 * made the way the bullet button makes one, and the words stay where they were when one is taken off); what it does not carry is left.
 */
export function paintParagraphs(theme: Theme, baseStyle: string, text: Text, set: NonNullable<PaintFormat["paragraph"]>): Text {
  const steps: ((ctx: EditorContext) => Command)[] = [];
  if (set.align) steps.push(() => setAlign(set.align as Align));
  if (set.lineSpacing !== undefined) steps.push(() => setLineSpacing(set.lineSpacing ?? null));
  if (set.spaceBefore !== undefined || set.spaceAfter !== undefined) steps.push(() => setParagraphSpacing({ before: set.spaceBefore, after: set.spaceAfter }));
  if (set.list !== undefined) steps.push((ctx) => setList(set.list ?? null, ctx, (set.listStyle ?? null) as ListStyle | null));
  if (set.bulletSize !== undefined) steps.push(() => setBulletSize(set.bulletSize ?? null));
  if (set.bulletColor !== undefined) steps.push(() => setBulletColor(set.bulletColor ?? null));
  return steps.reduce((now, step) => runOnText(theme, baseStyle, now, step), text);
}

/** Whether a brush carries anything for words. */
export const carriesText = (paint: PaintFormat): boolean => Object.keys(paint.run).length > 0 || paint.paragraph !== undefined;

/** The text with the brush laid on it: its paragraphs set, then its runs; the same object when that changes nothing. */
export function paintText(theme: Theme, baseStyle: string, text: Text, paint: PaintFormat): Text {
  const looked = paint.paragraph ? paintParagraphs(theme, baseStyle, text, paint.paragraph) : text;
  const painted = paintRuns(looked, paint.run);
  return JSON.stringify(painted) === JSON.stringify(text) ? text : painted;
}
