// What a paragraph's page element takes from the words around and in it: the
// text of its list marker (a number depends on the items before it), where its
// lines start (the room a marker needs depends on the other items of its
// list), and the look of that marker and the size its lines are measured by
// (they depend on its runs). ProseMirror keeps these up to date as
// decorations, so the element is not redrawn, which would end an input
// method's composition.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { cssText } from "./css.ts";
import { nodeToParagraph } from "./convert.ts";
import { layoutParagraphs, markerTexts } from "./lists.ts";
import { paragraphOfAttrs } from "./paragraph-attrs.ts";
import { attrsOf } from "./schema.ts";
import type { EditorContext } from "./selection-info.ts";
import { geometryCss, markerPoints, paragraphFlowCss } from "./text-style.ts";

/** What a paragraph node adds to the page that depends on its own words only. */
interface Own {
  /** The flow style: line measure and marker look. */
  style: string;
  /** The size of its marker, in points. */
  points: number;
}

export function paragraphDecorations(ctx: EditorContext): Plugin {
  // A node that did not change keeps its style; nodes are new objects only when they change.
  const owns = new WeakMap<PMNode, Own>();
  const ownOf = (node: PMNode): Own => {
    let own = owns.get(node);
    if (own === undefined) {
      const paragraph = nodeToParagraph(node);
      own = { style: cssText(paragraphFlowCss(ctx.theme, ctx.baseStyle, paragraph)), points: markerPoints(ctx.theme, ctx.baseStyle, paragraph) };
      owns.set(node, own);
    }
    return own;
  };
  return new Plugin({
    props: {
      decorations(state) {
        const paragraphs: { node: PMNode; pos: number }[] = [];
        state.doc.forEach((node, pos) => paragraphs.push({ node, pos }));
        const listed = paragraphs.map(({ node }) => paragraphOfAttrs(attrsOf(node)));
        const markers = markerTexts(listed);
        const geometry = layoutParagraphs(
          listed,
          paragraphs.map(({ node }) => ownOf(node).points),
        );
        return DecorationSet.create(
          state.doc,
          paragraphs.map(({ node, pos }, index) => {
            const paragraph = listed[index];
            const where = geometry[index];
            const marker = markers[index];
            const style = [ownOf(node).style, paragraph && where ? cssText(geometryCss(paragraph, where)) : ""].filter((part) => part !== "").join(";");
            const onPage: Record<string, string> = { style };
            if (marker !== null && marker !== undefined) onPage["data-marker"] = marker;
            return Decoration.node(pos, pos + node.nodeSize, onPage);
          }),
        );
      },
    },
  });
}
