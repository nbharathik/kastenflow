// A board as a Markdown outline, to copy: its title, what sits outside any
// section as a list, then each section as a heading (a section inside another
// one a level down) over a list of what it holds. Cards become links to their
// notes, stickies and shapes their first line, link cards their address.
// Drawings and pictures have no words and are left out.

import type { BoardNode } from "../../../../lib/vault/types";
import { area, holds, rectOf, shownRect } from "./geometry";

/** How a note's card is written: a link to its note. */
export type LinkFor = (file: string, title: string | undefined) => string;

const firstLine = (text: string): string => text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";

/** The line a node is in the outline, or null when it has no words. */
function itemOf(node: BoardNode, link: LinkFor): string | null {
  if (node.kind === "file") {
    const file = node.file ?? "";
    return !node.missing && (file.endsWith(".md") || file.endsWith(".canvas")) ? link(file, node.title) : null;
  }
  if (node.kind === "link") return node.url ? `[${node.url}](${node.url})` : null;
  if (node.kind === "text" && !node.draw) return firstLine(node.text ?? "") || null;
  return null;
}

/** The smallest section holding `node`, if one does. */
function holder(sections: readonly BoardNode[], node: BoardNode): BoardNode | null {
  let best: BoardNode | null = null;
  for (const section of sections) {
    if (section.id === node.id || !holds(rectOf(section), shownRect(node))) continue;
    if (!best || area(rectOf(section)) < area(rectOf(best))) best = section;
  }
  return best;
}

const byPlace = (a: BoardNode, b: BoardNode) => a.y - b.y || a.x - b.x;

export function boardOutline(title: string, nodes: readonly BoardNode[], link: LinkFor): string {
  const sections = nodes.filter((n) => n.kind === "group").sort(byPlace);
  const items = new Map<string | null, string[]>();
  for (const node of [...nodes].filter((n) => n.kind !== "group").sort(byPlace)) {
    const line = itemOf(node, link);
    if (!line) continue;
    const at = holder(sections, node)?.id ?? null;
    items.set(at, [...(items.get(at) ?? []), line]);
  }
  const depth = (section: BoardNode): number => {
    const parent = holder(sections, section);
    return parent ? 1 + depth(parent) : 0;
  };
  const lines = [`# ${title}`, ""];
  const list = (at: string | null) => {
    const found = items.get(at);
    if (found) lines.push(...found.map((line) => `- ${line}`), "");
  };
  list(null);
  for (const section of sections) {
    lines.push(`${"#".repeat(Math.min(6, 2 + depth(section)))} ${section.label?.trim() || "Section"}`, "");
    list(section.id);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
