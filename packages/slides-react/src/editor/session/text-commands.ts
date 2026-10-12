// Formatting the text of whole elements, for when a box is selected but its
// text is not being edited: bold on a selected box makes all of its words bold.
// While text is being edited the text editor does this itself, and these are the
// same commands, run on the whole text of each selected box.

import type { Align, Element, ListKind, ListStyle, Probe, Script, SetRichText, Text, TextFit } from "@kasten-slides/wasm";

import { boxOf, placeholderOf } from "../../theme/index.ts";
import {
  type CaseMode,
  type Command,
  applyListStyle,
  changeCase,
  clearFormatting,
  continuePreviousList,
  formatOfText,
  indent,
  moveParagraphs,
  restartNumbering,
  runOnText,
  setAlign,
  setBulletColor,
  setBulletSize,
  setFlag,
  setIndents,
  setLineSpacing,
  setList,
  setParagraphSpacing,
  setStartNumber,
  setValueMark,
} from "../../text/commands.ts";
import type { FormatState, Tri } from "../../text/format-state.ts";
import type { EditorContext } from "../../text/selection-info.ts";
import type { EditorSession } from "./session.ts";

export type { FormatState, Tri };

function textOf(element: Element): Text | null {
  if (element.type === "text") return element.text;
  if (element.type === "shape") return element.text ?? null;
  if (element.type === "connector") return element.label ?? null;
  return null;
}

/** One value across many, or "mixed" when they differ. */
function agree<T>(values: readonly T[], none: T): T | "mixed" {
  if (values.length === 0) return none;
  return values.every((v) => v === values[0]) ? (values[0] as T) : "mixed";
}

/** What formatting says when nothing is selected. */
const NOTHING: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  color: null,
  size: null,
  font: null,
  align: "left",
  list: null,
  level: 0,
  link: null,
  lineSpacing: null,
  script: null,
  smallCaps: false,
  allCaps: false,
  spacing: null,
  listStyle: null,
  start: null,
  bulletColor: null,
  bulletSize: null,
  spaceBefore: null,
  spaceAfter: null,
  marginLeft: 0,
  indent: 0,
  fit: "none",
  wrap: true,
};

/** The formatting of several boxes as one: what they agree on, and "mixed" where they do not. */
export function mergeFormats(states: readonly FormatState[]): FormatState {
  const first = states[0];
  if (!first) return NOTHING;
  const of = <K extends keyof FormatState>(key: K): FormatState[K] | "mixed" => agree(states.map((s) => s[key]), first[key]) as FormatState[K] | "mixed";
  return {
    bold: of("bold") as Tri,
    italic: of("italic") as Tri,
    underline: of("underline") as Tri,
    strike: of("strike") as Tri,
    code: of("code") as Tri,
    color: of("color") as FormatState["color"],
    size: of("size") as FormatState["size"],
    font: of("font") as FormatState["font"],
    align: of("align") as FormatState["align"],
    list: of("list") as FormatState["list"],
    level: Math.max(0, ...states.map((s) => s.level)),
    link: of("link") as FormatState["link"],
    lineSpacing: of("lineSpacing") as FormatState["lineSpacing"],
    script: of("script") as FormatState["script"],
    smallCaps: of("smallCaps") as Tri,
    allCaps: of("allCaps") as Tri,
    spacing: of("spacing") as FormatState["spacing"],
    listStyle: of("listStyle") as FormatState["listStyle"],
    start: first.start,
    bulletColor: of("bulletColor") as FormatState["bulletColor"],
    bulletSize: of("bulletSize") as FormatState["bulletSize"],
    spaceBefore: of("spaceBefore") as FormatState["spaceBefore"],
    spaceAfter: of("spaceAfter") as FormatState["spaceAfter"],
    marginLeft: of("marginLeft") as FormatState["marginLeft"],
    indent: of("indent") as FormatState["indent"],
    fit: first.fit,
    wrap: states.every((s) => s.wrap),
  };
}

/** The formatting shared by the runs and paragraphs of these texts, each set in the text style it is given. */
export function summarize(texts: readonly { text: Text; baseStyle: string }[], theme: Parameters<typeof formatOfText>[0]): FormatState {
  return mergeFormats(texts.map(({ text, baseStyle }) => formatOfText(theme, baseStyle, text)));
}

export class TextCommands {
  constructor(private readonly s: EditorSession) {}

  private targets(ids: readonly string[]): { element: Element; text: Text; baseStyle: string }[] {
    const { theme } = this.s.deck;
    const layout = this.s.slide.layout;
    return this.s.elements.find(ids).flatMap((element) => {
      const text = textOf(element);
      return text ? [{ element, text, baseStyle: placeholderOf(theme, layout, element)?.style ?? "body" }] : [];
    });
  }

  /** How the text of the selected elements looks. */
  state(ids: readonly string[] = this.s.state.selection): FormatState {
    return summarize(this.targets(ids), this.s.deck.theme);
  }

  /** Rewrites the text of each target as one step of undo. */
  private rewrite(ids: readonly string[], change: (text: Text, baseStyle: string) => Text): void {
    const slide = this.s.state.slideId;
    const operations = this.targets(ids).flatMap(({ element, text, baseStyle }) => {
      const next = change(text, baseStyle);
      return next === text || JSON.stringify(next) === JSON.stringify(text) ? [] : [["set_rich_text", { slide, id: element.id, text: next }] satisfies ["set_rich_text", SetRichText]];
    });
    if (operations.length > 0) this.s.run(() => this.s.core.applyBatch(operations));
  }

  /** Runs one of the editor's commands on all the words of each element: the same command a text box being edited runs on its selection. */
  apply(make: (ctx: EditorContext) => Command, ids: readonly string[] = this.s.state.selection): void {
    const { theme } = this.s.deck;
    this.rewrite(ids, (text, baseStyle) => runOnText(theme, baseStyle, text, make));
  }

  /** Sets bold, italic, underline or strike on all the words, or clears it if all had it already. */
  toggle(flag: "b" | "i" | "u" | "s", ids: readonly string[] = this.s.state.selection): void {
    const name = { b: "bold", i: "italic", u: "underline", s: "strike" }[flag] as "bold" | "italic" | "underline" | "strike";
    this.toggleMark(name, ids);
  }

  /** The inline code, small capitals or capitals switch (and bold, italic, underline and strike): on for all the boxes unless all have it already. */
  toggleMark(name: "bold" | "italic" | "underline" | "strike" | "code" | "smallCaps" | "allCaps", ids: readonly string[] = this.s.state.selection): void {
    const on = this.state(ids)[name] === true;
    this.apply(() => setFlag(name, !on), ids);
  }

  /** Sets a run property on all the words; null puts the style's own value back. */
  setRun(key: "color" | "size" | "font" | "link" | "spacing", value: string | number | null, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setValueMark(key, value), ids);
  }

  /** Raised or lowered words; switched off where all the words have it already. */
  setScript(script: Script | null, ids: readonly string[] = this.s.state.selection): void {
    const on = script !== null && this.state(ids).script === script;
    this.apply(() => setValueMark("script", on ? null : script), ids);
  }

  setAlign(align: Align, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setAlign(align), ids);
  }

  /** Makes every paragraph a bulleted or numbered list, or a plain paragraph if all already were that kind. */
  toggleList(kind: ListKind, ids: readonly string[] = this.s.state.selection): void {
    const all = this.state(ids).list === kind;
    this.apply((ctx) => setList(all ? null : kind, ctx), ids);
  }

  /** One style of list on every paragraph; null takes the list off. */
  setListStyle(style: ListStyle | null, ids: readonly string[] = this.s.state.selection): void {
    this.apply((ctx) => (style === null ? setList(null, ctx) : applyListStyle(style, ctx)), ids);
  }

  restartNumbering(ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => restartNumbering, ids);
  }

  continueList(ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => continuePreviousList, ids);
  }

  setStartNumber(at: number | null, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setStartNumber(at), ids);
  }

  /** The size of the markers of every list item as a multiple of its words' size (1.5 is 150%); null is the words' size. */
  setBulletSize(share: number | null, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setBulletSize(share), ids);
  }

  /** The colour of the markers of every list item; null takes the colour of the words. */
  setBulletColor(color: string | null, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setBulletColor(color), ids);
  }

  indent(delta: 1 | -1, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => indent(delta), ids);
  }

  setIndents(indents: { marginLeft?: number | null; firstLine?: number | null }, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setIndents(indents), ids);
  }

  moveParagraphs(delta: 1 | -1, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => moveParagraphs(delta), ids);
  }

  setLineSpacing(multiple: number | null, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setLineSpacing(multiple), ids);
  }

  setParagraphSpacing(spacing: { before?: number | null; after?: number | null }, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => setParagraphSpacing(spacing), ids);
  }

  changeCase(mode: CaseMode, ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => changeCase(mode), ids);
  }

  /** What the box does when its words do not fit it, and whether lines wrap: kept with the text. */
  setBox(change: Pick<Text, "fit" | "wrap">, ids: readonly string[] = this.s.state.selection): void {
    this.rewrite(ids, (text) => {
      const next: Text = { ...text, ...change };
      if (next.fit === "none" || next.fit === null) delete next.fit;
      if (next.wrap === true || next.wrap === null) delete next.wrap;
      return next;
    });
  }

  /**
   * What the box does when its words do not fit it. "Resize shape to fit text" also makes each text box as tall as its
   * words, as one step of undo with the change, which only a page can say (it lays the words out to find out).
   */
  async setFit(fit: TextFit, ids: readonly string[] = this.s.state.selection): Promise<void> {
    if (fit !== "resize") return this.setBox({ fit }, ids);
    const { theme } = this.s.deck;
    const layout = this.s.slide.layout;
    const found = this.targets(ids);
    const heightOf = (element: Element): number => (element.type === "text" ? (boxOf(theme, layout, element)?.h ?? 0) : 0);
    const probes: Probe[] = found.flatMap(({ element, text, baseStyle }) => {
      const box = element.type === "text" ? boxOf(theme, layout, element) : null;
      return box ? [{ id: element.id, areaWidth: box.w, areaHeight: box.h, parts: [{ base: baseStyle, text }] }] : [];
    });
    const { loadMeasurer, measureProbes } = await import("../lint/measure.ts");
    await loadMeasurer();
    const heights = measureProbes(theme, probes);
    const slide = this.s.state.slideId;
    const operations: [string, unknown][] = [];
    for (const { element, text } of found) {
      const next: Text = { ...text, fit };
      if (JSON.stringify(next) !== JSON.stringify(text)) operations.push(["set_rich_text", { slide, id: element.id, text: next } satisfies SetRichText]);
      const needed = heights[element.id]?.textHeight;
      const have = heightOf(element);
      if (needed && Math.abs(needed - have) > 0.5) operations.push(["patch_elements", { slide, patches: [{ id: element.id, patch: { h: Math.ceil(needed) } }] }]);
    }
    if (operations.length > 0) this.s.run(() => this.s.core.applyBatch(operations as Parameters<typeof this.s.core.applyBatch>[0]));
  }

  /** Removes bold, colours, sizes and the rest, keeping the words, links and lists. */
  clearFormatting(ids: readonly string[] = this.s.state.selection): void {
    this.apply(() => clearFormatting, ids);
  }
}
