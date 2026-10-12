// Which few actions the bar over a selection offers, by what is selected.
// Everything else is in "More" (the board's menu), on a key, or in the
// palette: the bar stays small.

import type { BoardNode } from "../../../../lib/vault/types";

export type BarAction = "colour" | "size" | "open" | "fold" | "ungroup" | "align" | "group" | "remove" | "more";

/** A card for a note that can be opened and sized. */
export const isNoteCard = (node: BoardNode): boolean => node.kind === "file" && Boolean(node.file?.endsWith(".md")) && !node.missing;

export function barActions(nodes: readonly BoardNode[]): BarAction[] {
  if (nodes.length === 0) return [];
  if (nodes.length > 1) return ["colour", "align", "group", "remove", "more"];
  const node = nodes[0]!;
  // A section is a frame: it can be folded, or taken away leaving what is inside.
  if (node.kind === "group") return ["colour", "fold", "ungroup", "more"];
  if (isNoteCard(node)) return ["colour", "size", "open", "remove", "more"];
  return ["colour", "group", "remove", "more"];
}
