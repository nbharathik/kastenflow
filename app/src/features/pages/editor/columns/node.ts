// The columns block and its columns, as the editor holds them: `columns`
// holds one or more `column`, each of which holds ordinary blocks. A columns
// block cannot sit inside a column (guard.ts keeps it out).

import type { Node } from "@milkdown/kit/prose/model";
import { $nodeSchema } from "@milkdown/kit/utils";

import { NO_SOURCE, SourceBox } from "./source";
import { columnsMarkdown } from "./write";

/** The ratio from a pasted block's attribute: numbers joined by slashes, or nothing. */
export function pastedRatio(value: string | undefined): string {
  return /^\d+(?:\/\d+)*$/.test(value ?? "") ? value! : "";
}

export const columnsSchema = $nodeSchema("columns", (ctx) => ({
  group: "block",
  content: "column+",
  defining: true,
  isolating: true,
  attrs: { ratio: { default: "" }, source: { default: NO_SOURCE } },
  parseDOM: [{ tag: "div[data-columns]", getAttrs: (dom) => ({ ratio: pastedRatio((dom as HTMLElement).dataset.columns) }) }],
  toDOM: (node: Node) => ["div", { class: "kasten-columns", "data-columns": String(node.attrs.ratio) }, 0],
  parseMarkdown: {
    match: (node) => node.type === "columns",
    runner: (state, node, type) => {
      state.openNode(type, { ratio: String(node.ratio ?? ""), source: new SourceBox(String(node.source ?? ""), String(node.context ?? "")) });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "columns",
    // The whole block is written as one piece of text (markers included): see write.ts.
    runner: (state, node) => {
      state.addNode("html", undefined, columnsMarkdown(node, ctx));
    },
  },
}));

export const columnSchema = $nodeSchema("column", () => ({
  content: "block+",
  isolating: true,
  parseDOM: [{ tag: "div[data-column]" }],
  toDOM: () => ["div", { class: "kasten-column", "data-column": "" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "column",
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "column",
    runner: (state, node) => {
      state.next(node.content);
    },
  },
}));
