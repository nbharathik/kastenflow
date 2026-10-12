// The settings of a paragraph, as the attributes of a ProseMirror node and
// as fields of a `Paragraph`. Anything a paragraph holds that the format
// does not define travels in `extra`, as JSON, so it comes back unchanged.

import type { Align, ListKind, ListStyle, Paragraph, Run } from "@kasten-slides/wasm";

export interface ParagraphAttrs {
  align: Align | null;
  list: ListKind | null;
  level: number | null;
  style: string | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineSpacing: number | null;
  step: number | null;
  listStyle: ListStyle | null;
  start: number | null;
  bulletColor: string | null;
  bulletSize: number | null;
  marginLeft: number | null;
  indent: number | null;
  /**
   * The look of the paragraph's mark, as a JSON object of run fields without words ({"size":12,"b":true}): what
   * an empty paragraph is measured by and what words typed into it get. Only an empty paragraph has one; the
   * format keeps it as the one empty run such a paragraph holds. Null for none.
   */
  mark: string | null;
  /** The paragraph's unknown fields as a JSON object, or null. */
  extra: string | null;
}

export const NO_ATTRS: Readonly<ParagraphAttrs> = {
  align: null,
  list: null,
  level: null,
  style: null,
  spaceBefore: null,
  spaceAfter: null,
  lineSpacing: null,
  step: null,
  listStyle: null,
  start: null,
  bulletColor: null,
  bulletSize: null,
  marginLeft: null,
  indent: null,
  mark: null,
  extra: null,
};

/** The fields of a paragraph the format defines. */
export const PARAGRAPH_KEYS: ReadonlySet<string> = new Set(["runs", "align", "list", "level", "style", "spaceBefore", "spaceAfter", "lineSpacing", "step", "listStyle", "start", "bulletColor", "bulletSize", "marginLeft", "indent"]);

const ALIGNS: readonly string[] = ["left", "center", "right", "justify"];
const LISTS: readonly string[] = ["bullet", "number"];
const LIST_STYLES: readonly string[] = ["disc", "circle", "square", "arrow", "check", "dash", "decimal", "decimalParen", "lowerAlpha", "upperAlpha", "lowerRoman", "upperRoman"];

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);
const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** Attributes from anything: each one valid or null. What a node holds is checked here, not trusted. */
export function readAttrs(raw: Readonly<Record<string, unknown>>): ParagraphAttrs {
  const extra = raw.extra;
  return {
    align: typeof raw.align === "string" && ALIGNS.includes(raw.align) ? (raw.align as Align) : null,
    list: typeof raw.list === "string" && LISTS.includes(raw.list) ? (raw.list as ListKind) : null,
    level: whole(raw.level),
    style: typeof raw.style === "string" && raw.style !== "" ? raw.style : null,
    spaceBefore: number(raw.spaceBefore),
    spaceAfter: number(raw.spaceAfter),
    lineSpacing: number(raw.lineSpacing),
    step: whole(raw.step),
    listStyle: typeof raw.listStyle === "string" && LIST_STYLES.includes(raw.listStyle) ? (raw.listStyle as ListStyle) : null,
    start: whole(raw.start),
    bulletColor: typeof raw.bulletColor === "string" && raw.bulletColor !== "" ? raw.bulletColor : null,
    bulletSize: positive(raw.bulletSize),
    marginLeft: number(raw.marginLeft),
    indent: number(raw.indent),
    mark: typeof raw.mark === "string" ? markJson(parseObject(raw.mark)) : null,
    extra: typeof extra === "string" && extra !== "" ? extra : null,
  };
}

/** A look as the text a paragraph's `mark` holds: its fields in a fixed order, so the same look is always the same text; null when it has none. */
export function markJson(look: Readonly<Record<string, unknown>>): string | null {
  const keys = Object.keys(look)
    .filter((key) => key !== "t" && key !== "__proto__" && look[key] !== undefined)
    .sort();
  return keys.length > 0 ? JSON.stringify(Object.fromEntries(keys.map((key) => [key, look[key]]))) : null;
}

/** The run fields a paragraph's `mark` holds. */
export function lookOfMark(mark: string | null): Record<string, unknown> {
  const look = mark === null ? {} : parseObject(mark);
  delete look.t;
  return look;
}

/** The attributes for a paragraph of a text: its defined settings, and its unknown fields as JSON. A paragraph with no words keeps the look of its one empty run as its mark. */
export function attrsOfParagraph(paragraph: Paragraph): ParagraphAttrs {
  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(paragraph)) if (!PARAGRAPH_KEYS.has(key)) unknown[key] = value;
  const runs = Array.isArray(paragraph.runs) ? paragraph.runs : [];
  const first = runs[0];
  const mark = first && runs.every((run) => run.t === "") ? markJson(first) : null;
  return readAttrs({ ...paragraph, mark, extra: Object.keys(unknown).length > 0 ? JSON.stringify(unknown) : null });
}

/** A paragraph with these settings and these runs, its unknown fields put back. With no runs it has the one empty run that holds its mark. */
export function paragraphOfAttrs(attrs: ParagraphAttrs, runs: Run[] = []): Paragraph {
  const paragraph: Paragraph = { runs: runs.length > 0 ? runs : [{ t: "", ...lookOfMark(attrs.mark) }] };
  if (attrs.align !== null) paragraph.align = attrs.align;
  if (attrs.list !== null) paragraph.list = attrs.list;
  if (attrs.level !== null) paragraph.level = attrs.level;
  if (attrs.style !== null) paragraph.style = attrs.style;
  if (attrs.spaceBefore !== null) paragraph.spaceBefore = attrs.spaceBefore;
  if (attrs.spaceAfter !== null) paragraph.spaceAfter = attrs.spaceAfter;
  if (attrs.lineSpacing !== null) paragraph.lineSpacing = attrs.lineSpacing;
  if (attrs.step !== null) paragraph.step = attrs.step;
  if (attrs.listStyle !== null) paragraph.listStyle = attrs.listStyle;
  if (attrs.start !== null) paragraph.start = attrs.start;
  if (attrs.bulletColor !== null) paragraph.bulletColor = attrs.bulletColor;
  if (attrs.bulletSize !== null) paragraph.bulletSize = attrs.bulletSize;
  if (attrs.marginLeft !== null) paragraph.marginLeft = attrs.marginLeft;
  if (attrs.indent !== null) paragraph.indent = attrs.indent;
  if (attrs.extra !== null) {
    for (const [key, value] of Object.entries(parseObject(attrs.extra))) {
      if (!PARAGRAPH_KEYS.has(key) && key !== "__proto__") Object.defineProperty(paragraph, key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return paragraph;
}

/** A JSON object's fields, or none if the text is not one. */
export function parseObject(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
