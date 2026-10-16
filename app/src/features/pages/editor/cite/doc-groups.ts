// The citations of a page, found in the editor's document and not in the file:
// each text block's words are read with code, links, math and other inline
// pieces replaced by a stand-in character, so a bracket inside any of them is
// never taken for a citation, and each group is given in document positions.
// The page's Markdown is not touched by any of this.

import type { Node } from "@milkdown/kit/prose/model";

import { citationGroups } from "./scan";

/** One key in a group. */
export interface DocItem {
  key: string;
  /** The `@`, or the `-` before it, and the stretch of the key itself. */
  at: number;
  from: number;
  to: number;
  suppress: boolean;
}

/** A `[...]` with citations in it, in document positions: `from` is the `[` and `to` is just after the `]`. */
export interface DocGroup {
  from: number;
  to: number;
  /** The group's text as written, brackets included. */
  source: string;
  items: DocItem[];
}

/** Stands for what is not words: an atom, or text inside code or a link. */
const OBJECT = "￼";
const MASKED_MARKS = new Set(["inlineCode", "link", "code_inline", "inline_code"]);

/** The words of a text block and where each of its characters is in the document. */
function wordsOf(block: Node, pos: number): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  block.forEach((child, offset) => {
    const start = pos + 1 + offset;
    if (child.isText) {
      const value = child.text!;
      const masked = child.marks.some((mark) => MASKED_MARKS.has(mark.type.name));
      for (let i = 0; i < value.length; i++) at.push(start + i);
      text += masked ? OBJECT.repeat(value.length) : value;
    } else {
      at.push(start);
      text += OBJECT;
    }
  });
  return { text, at };
}

/** Every citation group in the document, in order. */
export function scanDoc(doc: Node): DocGroup[] {
  const out: DocGroup[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code || !node.textContent.includes("@")) return false;
    const { text, at } = wordsOf(node, pos);
    for (const group of citationGroups(text)) {
      const source = text.slice(group.from, group.to);
      // A group with a stand-in inside it holds something that is not words: leave it as it is.
      if (source.includes(OBJECT)) continue;
      out.push({
        from: at[group.from]!,
        to: at[group.to - 1]! + 1,
        source,
        items: group.items.map((i) => ({ key: i.key, at: at[i.at]!, from: at[i.keyFrom]!, to: at[i.keyTo - 1]! + 1, suppress: i.suppress })),
      });
    }
    return false;
  });
  return out;
}

/** The group the position `pos` is in or right beside, if any. */
export const groupAt = (groups: readonly DocGroup[], pos: number): DocGroup | undefined => groups.find((g) => pos >= g.from && pos <= g.to);
