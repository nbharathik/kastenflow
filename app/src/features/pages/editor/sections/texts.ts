// The words of each slide of a page as Markdown, written the way the page
// writes them: what making slides of a page's sections starts from.

import { schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";

import type { SectionText } from "./registry";
import { slidesOf } from "./slides";

export function slideTexts(ctx: Ctx, doc: Node): SectionText[] {
  const serialize = ctx.get(serializerCtx);
  const { topNodeType } = ctx.get(schemaCtx);
  return slidesOf(doc).map((slide) => ({
    title: slide.title,
    markdown: serialize(topNodeType.create(null, doc.slice(slide.from, slide.to).content)).trim(),
  }));
}
