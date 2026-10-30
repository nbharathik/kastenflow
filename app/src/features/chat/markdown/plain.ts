// An answer's Markdown as plain text, for "Copy": the words without the
// marks. "Copy as Markdown" gives the source as it is.

import { parseBlocks, type Block } from "./blocks";
import { parseInline, wordsOf } from "./inline";

const words = (text: string) => wordsOf(parseInline(text));

function lines(block: Block): string[] {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return [words(block.text)];
    case "code":
    case "math":
      return block.text.split("\n");
    case "rule":
      return ["---"];
    case "quote":
      return block.blocks.flatMap(lines).map((line) => `> ${line}`.trimEnd());
    case "table":
      return [block.head, ...block.rows].map((row) => row.map(words).join("\t"));
    case "list":
      return block.items.flatMap((item, i) => {
        const mark = block.ordered ? `${block.start + i}. ` : "- ";
        const box = item.checked === null ? "" : item.checked ? "[x] " : "[ ] ";
        const inner = item.blocks.flatMap(lines);
        return inner.map((line, k) => (k === 0 ? `${mark}${box}${line}` : `${" ".repeat(mark.length)}${line}`));
      });
  }
}

/** `markdown` with its marks taken out: blocks apart by a blank line, lists with their bullets or numbers, links as their words. */
export function plainText(markdown: string): string {
  return parseBlocks(markdown)
    .map((block) => lines(block).join("\n"))
    .join("\n\n");
}
