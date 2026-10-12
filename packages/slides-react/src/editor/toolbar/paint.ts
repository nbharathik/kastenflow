// The paint format brush: pick up how the words and the box in hand look, then
// lay that on the next thing clicked. What was picked up lives in `ui.paint`;
// putting it down is done here, by watching for the selection to move.

import type { Align, Element, ListStyle, Run, Text, Theme } from "@kasten-slides/wasm";
import { useEffect } from "react";

import { type Command, runOnText, setAlign, setBulletColor, setBulletSize, setLineSpacing, setList, setParagraphSpacing } from "../../text/commands.ts";
import type { FormatState } from "../../text/format-state.ts";
import type { EditorContext } from "../../text/selection-info.ts";
import { placeholderOf } from "../../theme/index.ts";
import type { CommandContext } from "../commands/index.ts";
import { shownFormat } from "../menus/format-view.ts";
import type { Patch } from "../session/elements.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi, PaintFormat } from "../ui-state.ts";

/** The looks of a box that the brush copies. */
const STYLE_KEYS = ["fill", "stroke", "radius", "shadow", "opacity", "startArrow", "endArrow"] as const;
/** Arrowheads are only for lines. */
const ARROW_KEYS: readonly string[] = ["startArrow", "endArrow"];
/** The elements that have a look of their own to copy or to take. */
const STYLED = new Set<Element["type"]>(["shape", "text", "line", "connector"]);
const HEADED = new Set<Element["type"]>(["line", "connector"]);

const textOf = (element: Element): Text | null => (element.type === "text" ? element.text : element.type === "shape" ? (element.text ?? null) : null);

/** A yes or a no; undefined where the selection holds both. */
const flag = (value: boolean | "mixed"): boolean | undefined => (value === "mixed" ? undefined : value);

/**
 * How the words and the box in hand look: the text being edited, else the
 * selected elements. Null when nothing is selected or open.
 */
export function capturePaint(ctx: CommandContext): PaintFormat | null {
  const { session, ui } = ctx;
  const picked = session.elements.find();
  const source = session.elements.find(session.state.editing ? [session.state.editing] : picked.slice(0, 1).map((e) => e.id))[0];
  if (!source && !ui.state.text) return null;

  const run: PaintFormat["run"] = {};
  let paragraph: PaintFormat["paragraph"];
  if (ui.state.text !== null || picked.some((e) => textOf(e) !== null)) {
    const format = shownFormat(ctx);
    for (const [key, value] of [["b", flag(format.bold)], ["i", flag(format.italic)], ["u", flag(format.underline)], ["s", flag(format.strike)]] as const) {
      if (value !== undefined) run[key] = value;
    }
    if (typeof format.color === "string" && format.color !== "mixed") run.color = format.color;
    if (typeof format.size === "number") run.size = format.size;
    if (typeof format.font === "string" && format.font !== "mixed") run.font = format.font;
    if (format.script !== "mixed") run.script = format.script;
    for (const [key, value] of [["smallCaps", flag(format.smallCaps)], ["allCaps", flag(format.allCaps)]] as const) {
      if (value !== undefined) run[key] = value;
    }
    if (format.spacing !== "mixed") run.spacing = format.spacing;
    paragraph = paragraphOf(format);
  }

  const brush: PaintFormat = { run, ...(paragraph && Object.keys(paragraph).length > 0 ? { paragraph } : {}) };
  if (!source || !STYLED.has(source.type)) return brush;
  const style: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    const value = source.style?.[key];
    if (value != null) style[key] = structuredClone(value);
  }
  return { ...brush, style };
}

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

/** The runs with what the brush carries laid over: a flag it lacks is taken off, colour, size and font it lacks go back to the text style's. */
function paintRuns(text: Text, run: PaintFormat["run"]): Text {
  const paint = (old: Run): Run => {
    const { b, i, u, s, color: _color, size: _size, font: _font, script, smallCaps, allCaps, spacing, ...rest } = old;
    const keep = (name: "b" | "i" | "u" | "s", was: boolean | undefined) => {
      const now = run[name] === undefined ? was : run[name];
      return now ? { [name]: true } : {};
    };
    const raised = run.script === undefined ? script : run.script;
    const gap = run.spacing === undefined ? spacing : run.spacing;
    return {
      ...rest,
      ...keep("b", b),
      ...keep("i", i),
      ...keep("u", u),
      ...keep("s", s),
      ...(run.color ? { color: run.color } : {}),
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
function paintParagraphs(theme: Theme, baseStyle: string, text: Text, set: NonNullable<PaintFormat["paragraph"]>): Text {
  const steps: ((ctx: EditorContext) => Command)[] = [];
  if (set.align) steps.push(() => setAlign(set.align as Align));
  if (set.lineSpacing !== undefined) steps.push(() => setLineSpacing(set.lineSpacing ?? null));
  if (set.spaceBefore !== undefined || set.spaceAfter !== undefined) steps.push(() => setParagraphSpacing({ before: set.spaceBefore, after: set.spaceAfter }));
  if (set.list !== undefined) steps.push((ctx) => setList(set.list ?? null, ctx, (set.listStyle ?? null) as ListStyle | null));
  if (set.bulletSize !== undefined) steps.push(() => setBulletSize(set.bulletSize ?? null));
  if (set.bulletColor !== undefined) steps.push(() => setBulletColor(set.bulletColor ?? null));
  return steps.reduce((now, step) => runOnText(theme, baseStyle, now, step), text);
}

/**
 * What to send so that `have` becomes `want`. A merge patch merges an object
 * into the one that is there, so the keys `have` has and `want` has not are
 * sent as null, to be taken off.
 */
function replacing(want: Patch[string], have: Patch[string]): Patch[string] {
  if (want === null || typeof want !== "object" || Array.isArray(want) || have === null || typeof have !== "object" || Array.isArray(have)) return want;
  const gone = Object.keys(have).filter((key) => !(key in want));
  return { ...want, ...Object.fromEntries(gone.map((key) => [key, null])) };
}

/** Lays the brush's look on the elements: one change for each, so one step of undo for each. */
export function applyPaint(session: EditorSession, paint: PaintFormat, ids: readonly string[]): void {
  const brushText = Object.keys(paint.run).length > 0 || paint.paragraph !== undefined;
  const { theme } = session.deck;
  for (const element of session.elements.find(ids)) {
    const patch: Patch = {};
    const text = textOf(element);
    if (brushText && text) {
      const baseStyle = placeholderOf(theme, session.slide.layout, element)?.style ?? "body";
      const looked = paint.paragraph ? paintParagraphs(theme, baseStyle, text, paint.paragraph) : text;
      const painted = paintRuns(looked, paint.run);
      if (JSON.stringify(painted) !== JSON.stringify(text)) patch.text = painted as unknown as Patch;
    }
    if (paint.style && STYLED.has(element.type)) {
      const change: Patch = {};
      for (const key of STYLE_KEYS) {
        if (ARROW_KEYS.includes(key) && !HEADED.has(element.type)) continue;
        const want = (paint.style[key] ?? null) as Patch[string];
        const have = (element.style?.[key] ?? null) as Patch[string];
        if (JSON.stringify(want) !== JSON.stringify(have)) change[key] = replacing(want, have);
      }
      if (Object.keys(change).length > 0) patch.style = change;
    }
    if (Object.keys(patch).length > 0) session.elements.patch(patch, [element.id]);
  }
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Puts the brush down. While `ui.paint` is set, the next time the selection
 * moves to something else, the brush is laid on it and put away. Escape puts
 * it away without laying it anywhere.
 */
export function usePaintBrush(session: EditorSession, ui: EditorUi): void {
  useEffect(() => {
    /** What was selected when the brush picked its look up. */
    let from: readonly string[] | null = ui.state.paint ? [...session.state.selection] : null;
    const watch = () => {
      const brush = ui.state.paint;
      if (!brush) {
        from = null;
        return;
      }
      if (from === null) {
        from = [...session.state.selection];
        return;
      }
      const now = session.state.selection;
      if (now.length === 0 || sameIds(now, from)) return;
      from = null;
      ui.setPaint(null);
      applyPaint(session, brush, now);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ui.state.paint) return;
      event.stopPropagation();
      ui.setPaint(null);
    };
    const stopSession = session.subscribe(watch);
    const stopUi = ui.subscribe(watch);
    document.addEventListener("keydown", escape, true);
    return () => {
      stopSession();
      stopUi();
      document.removeEventListener("keydown", escape, true);
    };
  }, [session, ui]);
}
