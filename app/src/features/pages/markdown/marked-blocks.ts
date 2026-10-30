// Which blocks of an open page show an agent mark. The core marks lines of the
// body; a block shows a mark when its lines as loaded overlap one, until the
// person edits the block. Blocks are followed from the load to the document the
// way saving follows them (save.ts), so an edited block drops its mark at once.

import { alignSequences } from "./align";
import type { Snapshot } from "./codec";

/** A top-level block as the note was loaded. */
export interface LoadedBlock<N> {
  /** The first line of the body it spans, from 0. */
  start: number;
  /** The line after its last. */
  end: number;
  /** The nodes the editor showed for it. */
  nodes: readonly N[];
}

/** What of a mark this needs: its lines, and when it was written. */
export interface LineMark {
  start: number;
  end: number;
  time: number;
}

export interface MarkedBlock<M> {
  /** Where its nodes stand in the document now, as top-level indices. */
  from: number;
  to: number;
  /** The mark whose first unedited block this is, for the badge; the
   * newest if several start here. */
  badge: M | null;
  /** When the newest mark over the block was written. */
  time: number;
}

const newlines = (text: string) => {
  let n = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n++;
  return n;
};

/** Each block of a loaded note with the lines of the body it spans. */
export function loadedBlocks<N>(snapshot: Snapshot<N>): LoadedBlock<N>[] {
  let line = 0;
  return snapshot.units.map((unit) => {
    line += newlines(unit.gap);
    const start = line;
    line += newlines(unit.src);
    return { start, end: line + 1, nodes: unit.nodes };
  });
}

/** The blocks that show a mark in `current`, the document's top-level nodes
 * now, in order. A block counts as unedited while all its nodes are still
 * there, in order and side by side. */
export function markedBlocks<N, M extends LineMark>(
  blocks: readonly LoadedBlock<N>[],
  marks: readonly M[],
  current: readonly N[],
  eq: (a: N, b: N) => boolean,
): MarkedBlock<M>[] {
  if (marks.length === 0 || blocks.length === 0) return [];
  const match = alignSequences(
    blocks.flatMap((b) => b.nodes),
    current,
    eq,
  );
  const out: MarkedBlock<M>[] = [];
  const badged = new Set<M>();
  let k = 0;
  for (const block of blocks) {
    const at = match.slice(k, k + block.nodes.length);
    k += block.nodes.length;
    const first = at[0];
    if (first === undefined || first < 0 || !at.every((c, j) => c === first + j)) continue;
    const over = marks.filter((m) => m.start < block.end && block.start < m.end);
    if (over.length === 0) continue;
    const starting = over.filter((m) => !badged.has(m));
    for (const m of starting) badged.add(m);
    const badge = starting.reduce<M | null>((a, m) => (a === null || m.time >= a.time ? m : a), null);
    out.push({ from: first, to: first + block.nodes.length, badge, time: over.reduce((t, m) => Math.max(t, m.time), 0) });
  }
  return out;
}
