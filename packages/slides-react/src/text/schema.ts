// The ProseMirror schema of one text object: paragraphs of text, and the
// formatting of a run as marks. The schema is made for a theme and a box
// style, because it also says how everything is drawn, with the same
// functions the read-only drawing uses.
//
// A line break is a "\n" in the text, drawn by `white-space: pre-wrap`, so
// there is no break node. Every mark and paragraph writes what it holds into
// `data-ks` attributes as well as its style, so that ProseMirror can read
// the page back into the same document, and so can a paste from another box.

import type { Theme } from "@kasten-slides/wasm";
import { type Mark, type MarkSpec, type Node as PMNode, type NodeSpec, Schema } from "prosemirror-model";

import { cssText } from "./css.ts";
import { MARK_ATTR, MARK_ORDER, type MarkInput, type MarkName, NUMBER_MARKS, wrapOf } from "./marks.ts";
import { NO_ATTRS, type ParagraphAttrs, paragraphOfAttrs, readAttrs } from "./paragraph-attrs.ts";
import { paragraphBlockCss } from "./text-style.ts";

export type TextSchema = Schema<"doc" | "paragraph" | "text", MarkName>;

/** The attributes of a paragraph node, checked. */
export const attrsOf = (node: PMNode): ParagraphAttrs => readAttrs(node.attrs);

const paragraphAttrSpec = Object.fromEntries([...Object.keys(NO_ATTRS)].map((key) => [key, { default: null }]));

/** The `data-ks-p` text of a paragraph: its settings that are set. */
function encodeAttrs(attrs: ParagraphAttrs): string {
  return JSON.stringify(Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== null)));
}

function decodeAttrs(text: string | null): ParagraphAttrs | false {
  if (text === null) return false;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? readAttrs(value as Record<string, unknown>) : false;
  } catch {
    return false;
  }
}

/** Whether a mark carries a value: a size, a font, a colour, a link address, a field name or the extra fields of a run. */
const isValued = (name: MarkName): name is keyof typeof MARK_ATTR => name in MARK_ATTR;

/** The mark as the input the drawing functions take. */
function inputOf(name: MarkName, mark: Mark): MarkInput {
  if (name === "size" || name === "spacing") return { name, value: typeof mark.attrs.value === "number" ? mark.attrs.value : 0 };
  if (isValued(name)) {
    const value: unknown = mark.attrs[MARK_ATTR[name]];
    return { name, value: typeof value === "string" ? value : "" };
  }
  return { name };
}

/** The element a mark is written as, with the attributes that let it be read back. */
export function markDom(theme: Theme, input: MarkInput): [tag: string, attrs: Record<string, string>, hole: 0] {
  const wrap = wrapOf(theme, input);
  const attrs: Record<string, string> = { ...wrap.attrs, "data-ks": input.name };
  if ("value" in input) attrs["data-v"] = String(input.value);
  if (wrap.className) attrs.class = wrap.className;
  const style = cssText(wrap.style);
  if (style) attrs.style = style;
  return [wrap.tag, attrs, 0];
}

/** The attributes a mark gets back from the page, or false when what it holds makes no sense. */
function markAttrs(name: MarkName, dom: HTMLElement): Record<string, unknown> | null | false {
  if (!isValued(name)) return null;
  const value = dom.getAttribute("data-v");
  if (NUMBER_MARKS.has(name)) {
    const size = Number(value);
    return value !== null && Number.isFinite(size) && (name === "spacing" ? size !== 0 : size > 0) ? { value: size } : false;
  }
  if (name === "script") return value === "super" || value === "sub" ? { value } : false;
  return value ? { [MARK_ATTR[name]]: value } : false;
}

function markSpec(theme: Theme, name: MarkName): MarkSpec {
  const tag = name === "link" ? "a" : "span";
  const definition: MarkSpec = {
    toDOM: (mark) => markDom(theme, inputOf(name, mark)),
    parseDOM: [{ tag: `${tag}[data-ks="${name}"]`, getAttrs: (dom) => (typeof dom === "string" ? false : markAttrs(name, dom)) }],
  };
  if (isValued(name)) definition.attrs = { [MARK_ATTR[name]]: { default: NUMBER_MARKS.has(name) ? 0 : "" } };
  // Text typed after a link or a field is not part of it.
  if (name === "link" || name === "field") definition.inclusive = false;
  return definition;
}

/** The schema for text set in `baseStyle` of `theme`. */
export function createTextSchema(theme: Theme, baseStyle: string): TextSchema {
  const nodes: Record<"doc" | "paragraph" | "text", NodeSpec> = {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "text*",
      group: "block",
      whitespace: "pre",
      attrs: paragraphAttrSpec,
      toDOM: (node) => {
        // The mark of a paragraph that has words is not written: the words say it.
        const attrs = node.content.size > 0 ? { ...attrsOf(node), mark: null } : attrsOf(node);
        return ["div", { class: "ks-p", style: cssText(paragraphBlockCss(theme, baseStyle, paragraphOfAttrs(attrs))), "data-ks-p": encodeAttrs(attrs) }, 0];
      },
      parseDOM: [{ tag: "div[data-ks-p]", preserveWhitespace: "full", getAttrs: (dom) => (typeof dom === "string" ? false : decodeAttrs(dom.getAttribute("data-ks-p"))) }],
    },
    text: { group: "inline" },
  };
  const marks = Object.fromEntries(MARK_ORDER.map((name) => [name, markSpec(theme, name)])) as Record<MarkName, MarkSpec>;
  return new Schema<"doc" | "paragraph" | "text", MarkName>({ nodes, marks });
}
