// A table node as plain text: what its cells say, and how each column aligns.

import type { Node } from "@milkdown/kit/prose/model";

import { parseWikiTarget } from "../links";
import type { Align } from "./cells";

export interface Grid {
  header: string[];
  rows: string[][];
  align: Align[];
}

/** What an atom inside a cell reads as. */
function leafText(node: Node): string {
  switch (node.type.name) {
    case "wiki_link": {
      const target = parseWikiTarget(String(node.attrs.value ?? ""));
      return target.alias || target.title;
    }
    case "math_inline":
      return String(node.attrs.value ?? "");
    case "image":
      return String(node.attrs.alt ?? "");
    case "hardbreak":
      return " ";
    default:
      return "";
  }
}

/** A cell's text: its words, with links and equations as they read. */
export function cellText(cell: Node): string {
  return cell.textBetween(0, cell.content.size, " ", leafText).replace(/\s+/g, " ").trim();
}

const alignment = (cell: Node): Align => {
  const value = cell.attrs.alignment;
  return value === "left" || value === "center" || value === "right" ? value : null;
};

export function gridOf(table: Node): Grid {
  const lines: Node[][] = [];
  table.forEach((row) => {
    const cells: Node[] = [];
    row.forEach((cell) => void cells.push(cell));
    lines.push(cells);
  });
  const [head = [], ...body] = lines;
  return { header: head.map(cellText), rows: body.map((cells) => cells.map(cellText)), align: head.map(alignment) };
}
