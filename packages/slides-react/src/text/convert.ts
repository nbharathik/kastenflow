// Between the stored form of a text (paragraphs of runs) and the ProseMirror
// document the editor works on. Nothing is lost on the way: the settings a
// paragraph or a run has that the format does not define ride along as JSON,
// and a paragraph nobody edited comes back as the very object it was.

import type { Paragraph, Run, Text } from "@kasten-slides/wasm";
import { Fragment, Mark, type Node as PMNode } from "prosemirror-model";

import { MARK_ATTR, type MarkInput, RUN_KEYS, markInputsOf } from "./marks.ts";
import { attrsOfParagraph, paragraphOfAttrs, parseObject } from "./paragraph-attrs.ts";
import { type TextSchema, attrsOf } from "./schema.ts";

/** A mark of the schema for what a run carries. */
export function markFor(schema: TextSchema, input: MarkInput): Mark {
  const type = schema.marks[input.name];
  return "value" in input ? type.create({ [MARK_ATTR[input.name]]: input.value }) : type.create();
}

/** A paragraph as a node: its settings as attributes, its non-empty runs as text with marks. */
export function paragraphToNode(paragraph: Paragraph, schema: TextSchema): PMNode {
  const nodes: PMNode[] = [];
  for (const run of Array.isArray(paragraph.runs) ? paragraph.runs : []) {
    if (typeof run.t !== "string" || run.t === "") continue;
    nodes.push(schema.text(run.t, markInputsOf(run).map((input) => markFor(schema, input))));
  }
  return schema.nodes.paragraph.create({ ...attrsOfParagraph(paragraph) }, Fragment.fromArray(nodes));
}

/** A text as a document. A text without paragraphs is a document with one empty paragraph. */
export function textToDoc(text: Text, schema: TextSchema): PMNode {
  const paragraphs = text.paragraphs.map((paragraph) => paragraphToNode(paragraph, schema));
  return schema.node("doc", null, paragraphs.length > 0 ? paragraphs : [schema.nodes.paragraph.create()]);
}

/** The run a stretch of text with these marks stands for. */
function runOf(text: string, marks: readonly Mark[]): Run {
  const run: Run = { t: text };
  const has = (name: string): boolean => marks.some((mark) => mark.type.name === name);
  const value = (name: string, key: string): unknown => marks.find((mark) => mark.type.name === name)?.attrs[key];
  if (has("bold")) run.b = true;
  if (has("italic")) run.i = true;
  if (has("underline")) run.u = true;
  if (has("strike")) run.s = true;
  const color = value("color", "value");
  if (typeof color === "string" && color !== "") run.color = color;
  const size = value("size", "value");
  if (typeof size === "number" && size > 0) run.size = size;
  const font = value("font", "value");
  if (typeof font === "string" && font !== "") run.font = font;
  const link = value("link", "href");
  if (typeof link === "string" && link !== "") run.link = link;
  if (has("code")) run.code = true;
  if (has("math")) run.math = true;
  const field = value("field", "name");
  if (typeof field === "string" && field !== "") run.field = field;
  const script = value("script", "value");
  if (script === "super" || script === "sub") run.script = script;
  if (has("smallCaps")) run.smallCaps = true;
  if (has("allCaps")) run.allCaps = true;
  const spacing = value("spacing", "value");
  if (typeof spacing === "number" && spacing !== 0) run.spacing = spacing;
  const extra = value("extra", "json");
  if (typeof extra === "string") {
    for (const [key, entry] of Object.entries(parseObject(extra))) {
      if (!RUN_KEYS.has(key) && key !== "__proto__") Object.defineProperty(run, key, { value: entry, enumerable: true, writable: true, configurable: true });
    }
  }
  return run;
}

/** Whether two runs differ only in their words. */
function sameLook(a: Run, b: Run): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("t");
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  return [...keys].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

/** A paragraph node as a paragraph: neighbouring stretches that look alike are one run, and an empty one has one empty run. */
export function nodeToParagraph(node: PMNode): Paragraph {
  const runs: Run[] = [];
  node.forEach((child) => {
    if (!child.isText || !child.text) return;
    const run = runOf(child.text, child.marks);
    const last = runs[runs.length - 1];
    if (last && sameLook(last, run)) last.t += run.t;
    else runs.push(run);
  });
  return paragraphOfAttrs(attrsOf(node), runs);
}

/** What a paragraph's mark keeps of a look: the character settings, not a link, a field or math, which belong to words. */
const NOT_OF_A_MARK: ReadonlySet<string> = new Set(["t", "link", "field", "math"]);

/** The look the marks stand for, as the fields of a run without its words: what an empty paragraph keeps as its mark. */
export function lookOfMarks(marks: readonly Mark[]): Record<string, unknown> {
  const look: Record<string, unknown> = { ...runOf("", marks) };
  for (const key of NOT_OF_A_MARK) delete look[key];
  return look;
}

/** The marks a paragraph's look stands for: what words typed into the empty paragraph get. */
export function marksOfLook(schema: TextSchema, look: Readonly<Record<string, unknown>>): Mark[] {
  const run = { ...look, t: "" } as Run;
  return markInputsOf(run)
    .filter((input) => !NOT_OF_A_MARK.has(input.name))
    .map((input) => markFor(schema, input));
}

/** The node a paragraph stands for, remembered: the same paragraph object is asked about again and again as someone types. */
const nodes = new WeakMap<TextSchema, WeakMap<Paragraph, PMNode>>();

function nodeOf(paragraph: Paragraph, schema: TextSchema): PMNode {
  let bySchema = nodes.get(schema);
  if (!bySchema) nodes.set(schema, (bySchema = new WeakMap()));
  let node = bySchema.get(paragraph);
  if (!node) bySchema.set(paragraph, (node = paragraphToNode(paragraph, schema)));
  return node;
}

/**
 * Whether two paragraph nodes are the same paragraph. The mark of a paragraph that has words is not
 * part of it: it is ignored there, and left as it was when words were typed into the paragraph.
 */
function sameParagraph(a: PMNode, b: PMNode): boolean {
  if (a.eq(b)) return true;
  if (a.content.size === 0 || b.content.size === 0 || a.type !== b.type || !a.content.eq(b.content) || !Mark.sameSet(a.marks, b.marks)) return false;
  return Object.keys(a.attrs).every((key) => key === "mark" || a.attrs[key] === b.attrs[key]);
}

/**
 * For each paragraph node of the document, the paragraph of `base` it still
 * is, or null if it was changed or is new. Nodes are matched by their words
 * first and then by everything they hold, so a paragraph that moved with an
 * insertion above it is still found.
 */
function matchToBase(docNodes: readonly PMNode[], base: readonly Paragraph[], schema: TextSchema): (Paragraph | null)[] {
  const byWords = new Map<string, number[]>();
  base.forEach((paragraph, index) => {
    const words = nodeOf(paragraph, schema).textContent;
    const list = byWords.get(words);
    if (list) list.push(index);
    else byWords.set(words, [index]);
  });
  const taken = new Set<number>();
  let cursor = 0;
  return docNodes.map((node, index) => {
    const candidates = byWords.get(node.textContent) ?? [];
    const order = [...candidates.filter((j) => j === index), ...candidates.filter((j) => j !== index && j >= cursor), ...candidates.filter((j) => j !== index && j < cursor)];
    for (const j of order) {
      const paragraph = base[j];
      if (paragraph === undefined || taken.has(j) || !sameParagraph(nodeOf(paragraph, schema), node)) continue;
      taken.add(j);
      cursor = j + 1;
      return paragraph;
    }
    return null;
  });
}

/**
 * The text a document stands for. `base` is the text the document was made
 * from or last written as: it supplies what the document does not hold (the
 * box's `valign`, `insets` and unknown fields), and every paragraph that is
 * still what it was in `base` is returned as the same object, with whatever
 * the format allowed it to have, such as empty runs or neighbouring runs that
 * look alike. Only paragraphs that were edited are written afresh, with
 * neighbouring runs that look alike merged.
 */
export function docToText(doc: PMNode, base: Text): Text {
  const schema = doc.type.schema as TextSchema;
  const docNodes: PMNode[] = [];
  doc.forEach((node) => docNodes.push(node));
  const only = docNodes[0];
  // A text with no paragraphs is a document of one empty, plain paragraph.
  if (base.paragraphs.length === 0 && docNodes.length === 1 && only !== undefined && only.eq(schema.nodes.paragraph.create())) return base;
  const matched = matchToBase(docNodes, base.paragraphs, schema);
  const paragraphs = docNodes.map((node, index) => matched[index] ?? nodeToParagraph(node));
  if (paragraphs.length === base.paragraphs.length && paragraphs.every((paragraph, index) => paragraph === base.paragraphs[index])) return base;
  return { ...base, paragraphs };
}
