// A page's outline: its headings and list items as a tree, in plain words,
// each with a key that names it among its siblings. A mind map is made from
// it, and brought back in step with the page by comparing keys.

export interface OutlineNode {
  /** The words for the branch: inline Markdown taken off, a to-do's box kept. */
  text: string;
  /** What names this line among its siblings: its words in lower case with
   * the to-do box off, and `#2`, `#3` for the same words again under the
   * same parent. Editing other lines never changes it. */
  key: string;
  children: OutlineNode[];
}

/** Most lines a map follows; bigger pages keep their first ones. */
export const MAX_NODES = 80;

/** Inline Markdown as plain words. */
export function plain(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?!\w)/g, "$1$2")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The part of a line's words that names it: no to-do box, lower case. */
export function wordsOf(text: string): string {
  return text.replace(/^[☐☑]\s+/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Gives every node its key, depth first. */
function keyed(nodes: OutlineNode[]): OutlineNode[] {
  const seen = new Map<string, number>();
  for (const node of nodes) {
    const words = wordsOf(node.text);
    const times = (seen.get(words) ?? 0) + 1;
    seen.set(words, times);
    node.key = times === 1 ? words : `${words}#${times}`;
    keyed(node.children);
  }
  return nodes;
}

/** The page's headings and list items as a tree, at most `limit` of them
 * (`cut` is true when there were more). */
export function readOutline(markdown: string, limit = MAX_NODES): { tree: OutlineNode[]; cut: boolean } {
  const top: OutlineNode[] = [];
  // Open headings by level, and open list items by indent under the last heading.
  const headings: { level: number; node: OutlineNode }[] = [];
  let items: { indent: number; node: OutlineNode }[] = [];
  let count = 0;
  let cut = false;
  let fence = false;
  const under = (node: OutlineNode, parent: OutlineNode | undefined) => (parent ? parent.children : top).push(node);
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const item = heading ? null : /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
    if (!heading && !item) continue;
    if (count >= limit) {
      cut = true;
      continue;
    }
    if (heading) {
      const level = heading[1]!.length;
      const node: OutlineNode = { text: plain(heading[2]!), key: "", children: [] };
      while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
      under(node, headings[headings.length - 1]?.node);
      headings.push({ level, node });
      items = [];
      count++;
    } else if (item) {
      const indent = item[1]!.replace(/\t/g, "    ").length;
      const box = item[2] === undefined ? "" : item[2] === " " ? "☐ " : "☑ ";
      const node: OutlineNode = { text: box + plain(item[3]!), key: "", children: [] };
      while (items.length && items[items.length - 1]!.indent >= indent) items.pop();
      under(node, items[items.length - 1]?.node ?? headings[headings.length - 1]?.node);
      items.push({ indent, node });
      count++;
    }
  }
  return { tree: keyed(top), cut };
}

/** The page's headings and list items as a tree, at most `limit` of them. */
export function outlineTree(markdown: string, limit = MAX_NODES): OutlineNode[] {
  return readOutline(markdown, limit).tree;
}
