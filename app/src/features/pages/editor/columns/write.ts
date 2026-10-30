// A columns node as Markdown. The markers and the blocks nobody touched are
// copied from the block's original source (kept on the node, out of sight of
// `eq`); the rest is written by the editor's serializer. Whatever comes out is
// checked: if it would not reopen as the same columns, the canonical form is
// written instead.

import { remarkCtx, schemaCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import { SerializerState } from "@milkdown/kit/transformer";

import { contextualParser } from "../../markdown/codec";
import { loadMarkdown, saveMarkdown, type MarkdownCodec } from "../../markdown/lossless";
import type { MdNode } from "../blocks/mdast";
import { milkdownCodec } from "../milkdown-codec";
import { markerRanges, withoutColumns } from "./remark";
import { composeColumns, splitSource, type OriginalColumns } from "./serialize";
import { contextOf, sourceOf } from "./source";

/** A column's blocks, written afresh: canonical Markdown, no blank paragraphs. */
function fresh(codec: MarkdownCodec<Node>, column: Node): string {
  const nodes = blocksOf(codec, column);
  return nodes.length === 0 ? "" : withoutColumns(() => codec.serialize(nodes)).trim();
}

/** A column's blocks without the empty paragraph a column with nothing in it holds. */
function blocksOf(codec: MarkdownCodec<Node>, column: Node): Node[] {
  const nodes: Node[] = [];
  column.forEach((n) => {
    if (!codec.isBlank?.(n)) nodes.push(n);
  });
  return nodes;
}

/** A column's blocks, written from its original text where the blocks are unchanged. */
function patched(codec: MarkdownCodec<Node>, column: Node, core: string, context: string): string {
  const nodes = blocksOf(codec, column);
  if (nodes.length === 0) return "";
  // The column's text is read the way the page read it: with the page's link and footnote
  // definitions, or an untouched block with a reference link would differ and be rewritten.
  const reader = context === "" ? codec : { ...codec, parse: contextualParser(codec, context) };
  try {
    return withoutColumns(() => saveMarkdown(reader, loadMarkdown(reader, core).snapshot, nodes)).trim();
  } catch {
    return fresh(codec, column);
  }
}

function originalOf(ctx: Ctx, src: string): OriginalColumns | null {
  if (src === "") return null;
  try {
    const { children } = ctx.get(remarkCtx).parse(src) as unknown as { children: MdNode[] };
    const marks = markerRanges(children);
    return marks ? splitSource(src, marks) : null;
  } catch {
    return null;
  }
}

/** Whether `text` reopens as one columns block with the same columns holding the same kinds of blocks. */
function reopensAs(codec: MarkdownCodec<Node>, text: string, node: Node): boolean {
  try {
    const got = codec.parse(text).filter((n) => !codec.isBlank?.(n));
    const one = got[0];
    if (got.length !== 1 || !one || one.type !== node.type || one.childCount !== node.childCount || one.attrs.ratio !== node.attrs.ratio) return false;
    const kinds = (column: Node) => blocksOf(codec, column).map((n) => n.type.name).join();
    for (let i = 0; i < node.childCount; i++) if (kinds(one.child(i)) !== kinds(node.child(i))) return false;
    return true;
  } catch {
    return false;
  }
}

/** The codec for a column's blocks. The editor's serializer is busy writing the columns block
 * itself and keeps one state, so the blocks are written by a serializer of their own. */
const codecs = new WeakMap<Ctx, MarkdownCodec<Node>>();
function nestedCodec(ctx: Ctx): MarkdownCodec<Node> {
  let codec = codecs.get(ctx);
  if (!codec) {
    codec = milkdownCodec(ctx, SerializerState.create(ctx.get(schemaCtx), ctx.get(remarkCtx)));
    codecs.set(ctx, codec);
  }
  return codec;
}

export function columnsMarkdown(node: Node, ctx: Ctx): string {
  const codec = nestedCodec(ctx);
  const original = originalOf(ctx, sourceOf(node));
  const ratio = String(node.attrs.ratio);
  const columns: Node[] = [];
  node.forEach((c) => void columns.push(c));
  if (original) {
    const text = composeColumns(
      original,
      ratio,
      columns.map((c, i) => (original.bodies[i] ? patched(codec, c, original.bodies[i]!.core, contextOf(node)) : fresh(codec, c))),
    );
    if (reopensAs(codec, text, node)) return text;
  }
  return composeColumns(null, ratio, columns.map((c) => fresh(codec, c)));
}
