// The lossless layer's offer to keep a table's own bytes: the patched text is
// used only when it reopens as the table the editor holds.

import type { Node } from "@milkdown/kit/prose/model";

import { patchTable } from "./patch";

/** `written` (the serializer's text for `node`) said in the bytes of `source`, or null. */
export function refineTable(parse: (markdown: string) => Node[], source: string, node: Node, written: string): string | null {
  if (node.type.name !== "table") return null;
  try {
    const want = parse(written)[0];
    const holds = (text: string) => {
      const got = parse(text);
      return got.length === 1 && got[0]!.type === node.type && (got[0]!.eq(node) || (want !== undefined && got[0]!.eq(want)));
    };
    // First with the empty cells the serializer writes as `<br />` left empty, then as written.
    for (const emptyCells of [true, false]) {
      const patched = patchTable(source, written, emptyCells);
      if (patched !== null && patched !== written && holds(patched)) return patched;
    }
    return null;
  } catch {
    return null;
  }
}
