// Writing a note back: copy every block the user did not change, re-serialize
// the rest, then check that the result reopens with the structure the editor
// holds.

import { alignSequences } from "./align";
import { contextualParser, isBlank, type MarkdownCodec, type Snapshot, type Unit } from "./codec";

/** A stretch of the saved text: a block copied from the source, or current
 * nodes written by the editor's serializer. `from`/`to` index `current`. */
type Segment<N> =
  | { kind: "verbatim"; unit: Unit<N>; from: number; to: number }
  | { kind: "fresh"; gap: string | null; from: number; to: number };

/** Where each source block stood, by its number in the source. Blocks that now
 * stand next to ones they never stood beside (moved, or with a block taken from
 * between them) are told by it. */
type Order<N> = ReadonlyMap<Unit<N>, number>;

/** The most blocks-by-nodes comparisons made to find blocks that moved. Past
 * it they are written afresh, as any edited block is. */
const MAX_MOVE_WORK = 1_000_000;

/** Re-serialized blocks can fuse with a neighbour (two lists with the same
 * marker become one list), so broken regions are re-serialized together with
 * their neighbours until the text reopens as the editor holds it. Each pass
 * merges segments, so this terminates; the cap only bounds pathological notes. */
const MAX_WIDENING_PASSES = 64;

/** Writes `current` back, copying every unchanged block from the source. */
export function saveMarkdown<N>(codec: MarkdownCodec<N>, snapshot: Snapshot<N>, current: readonly N[]): string {
  const parse = contextualParser(codec, snapshot.context);
  const planned = plan(codec, snapshot, current);
  const order: Order<N> = new Map(snapshot.units.map((u, ui) => [u, ui]));
  // With blocks moved, a block's own gap is right only after the block it followed.
  const gaps = planned.moved ? order : null;
  let { segments } = planned;
  for (let pass = 0; pass < MAX_WIDENING_PASSES; pass++) {
    const broken = brokenRegions(codec, snapshot, current, segments, parse, order, gaps);
    if (broken.length === 0) break;
    segments = widen(segments, broken);
  }
  return render(codec, snapshot, current, segments, true, gaps);
}

function plan<N>(codec: MarkdownCodec<N>, snapshot: Snapshot<N>, current: readonly N[]): { segments: Segment<N>[]; moved: boolean } {
  const { units } = snapshot;
  const match = alignSequences(
    units.flatMap((u) => u.nodes),
    current,
    codec.eq,
  );

  // A unit is intact when all its nodes survive, in order and adjacent.
  const placement = new Map<number, number>();
  let k = 0;
  units.forEach((u, ui) => {
    const idx = match.slice(k, k + u.nodes.length);
    k += u.nodes.length;
    const first = idx[0];
    if (first !== undefined && first >= 0 && idx.every((c, j) => c === first + j)) placement.set(ui, first);
  });

  // Blocks that are all still there but out of their old order were moved: they keep their source too.
  const moved = findMoves(units, placement, current, codec.eq);
  if (moved.size > 0) return { segments: planMoved(units, placement, moved, current), moved: true };

  const segments: Segment<N>[] = [];
  let cursor = 0;
  let hole: Unit<N>[] = [];
  const flush = (upTo: number) => {
    planHole(segments, hole, cursor, upTo);
    cursor = upTo;
    hole = [];
  };
  units.forEach((u, ui) => {
    const at = placement.get(ui);
    if (at === undefined) {
      hole.push(u);
      return;
    }
    flush(at);
    segments.push({ kind: "verbatim", unit: u, from: at, to: at + u.nodes.length });
    cursor = at + u.nodes.length;
  });
  flush(current.length);
  return { segments, moved: false };
}

/** Where blocks of the source stand now though not in their old order: each
 * unit (by its number) that was not found in place but whose nodes are all
 * held, together, somewhere the other blocks do not claim. The first such
 * place is taken, so identical blocks (a divider) are told apart by order. */
function findMoves<N>(units: readonly Unit<N>[], placement: ReadonlyMap<number, number>, current: readonly N[], eq: (a: N, b: N) => boolean): Map<number, number> {
  const moved = new Map<number, number>();
  const lost = units.filter((u, ui) => !placement.has(ui) && u.nodes.length > 0).length;
  if (lost === 0 || lost * current.length > MAX_MOVE_WORK) return moved;
  const taken = new Uint8Array(current.length);
  units.forEach((u, ui) => {
    const at = placement.get(ui);
    if (at !== undefined) taken.fill(1, at, at + u.nodes.length);
  });
  units.forEach((u, ui) => {
    const size = u.nodes.length;
    if (size === 0 || placement.has(ui)) return;
    for (let at = 0; at + size <= current.length; at++) {
      if (taken[at] === 1 || !u.nodes.every((node, j) => taken[at + j] === 0 && eq(node, current[at + j]!))) continue;
      moved.set(ui, at);
      taken.fill(1, at, at + size);
      return;
    }
  });
  return moved;
}

/** The plan when some blocks moved: every block that is held whole keeps its
 * source, in the order they stand now, and the rest is written afresh in the
 * gaps between them. An edited block waits for the gap after the block that
 * stood before it and stayed in order, as it would without any move. */
function planMoved<N>(units: readonly Unit<N>[], placement: ReadonlyMap<number, number>, moved: ReadonlyMap<number, number>, current: readonly N[]): Segment<N>[] {
  const pins = [...placement, ...moved].map(([ui, at]) => ({ ui, at, end: at + units[ui]!.nodes.length })).sort((a, b) => a.at - b.at);
  const waiting = new Map<number, Unit<N>[]>();
  let after = 0;
  units.forEach((u, ui) => {
    const at = placement.get(ui);
    if (at !== undefined) {
      after = at + u.nodes.length;
      return;
    }
    if (!moved.has(ui)) waiting.set(after, [...(waiting.get(after) ?? []), u]);
  });
  const segments: Segment<N>[] = [];
  let cursor = 0;
  for (const pin of pins) {
    planHole(segments, waiting.get(cursor) ?? [], cursor, pin.at);
    segments.push({ kind: "verbatim", unit: units[pin.ui]!, from: pin.at, to: pin.end });
    cursor = pin.end;
  }
  planHole(segments, waiting.get(cursor) ?? [], cursor, current.length);
  return segments;
}

/** Units between two intact blocks, and the current nodes that stand there:
 * edited units take their share of those nodes in order, the last takes any
 * extra; blocks the editor cannot show stay verbatim. */
function planHole<N>(segments: Segment<N>[], units: readonly Unit<N>[], from: number, to: number): void {
  const visible = units.filter((u) => u.nodes.length > 0);
  if (visible.length === 0 && to > from) segments.push({ kind: "fresh", gap: null, from, to });
  let pos = from;
  let v = 0;
  for (const u of units) {
    if (u.nodes.length === 0) {
      segments.push({ kind: "verbatim", unit: u, from: pos, to: pos });
      continue;
    }
    const last = ++v === visible.length;
    const take = last ? to - pos : Math.min(u.nodes.length, to - pos);
    segments.push({ kind: "fresh", gap: u.gap, from: pos, to: pos + take });
    pos += take;
  }
}

function render<N>(
  codec: MarkdownCodec<N>,
  snapshot: Snapshot<N>,
  current: readonly N[],
  segments: readonly Segment<N>[],
  whole: boolean,
  /** Set when blocks moved: the blocks' numbers, which tell when one stands after the block it followed. */
  order: Order<N> | null,
): string {
  const { eol } = snapshot;
  // Whatever comes first starts where the note started, even if the note's
  // first block was deleted and the new first block's gap was a separator.
  const lead = whole ? (snapshot.units[0]?.gap ?? "") : "";
  const out: string[] = [];
  let last: "none" | "verbatim" | "fresh" = "none";
  let before: Unit<N> | null = null;
  for (const seg of segments) {
    if (seg.kind === "verbatim") {
      // With blocks moved, a block's own gap is the right one only after the block it followed.
      const beside = order === null || (before !== null && order.get(seg.unit) === (order.get(before) ?? -2) + 1);
      const gap = last === "none" ? lead : last === "fresh" || !beside ? ensureBlankLine(seg.unit.gap, eol) : seg.unit.gap;
      out.push(gap + seg.unit.src);
      last = "verbatim";
      before = seg.unit;
      continue;
    }
    const nodes = current.slice(seg.from, seg.to).filter((n) => !isBlank(codec, n));
    if (nodes.length === 0) continue;
    const text = codec
      .serialize(nodes)
      .replace(/^(?:[ \t]*\r?\n)+/, "")
      .replace(/\s+$/, "")
      .replace(/\r?\n/g, eol);
    const gap = last === "none" ? lead : ensureBlankLine(seg.gap ?? eol + eol, eol);
    out.push(gap + text);
    last = "fresh";
    before = null;
  }
  if (!whole) return out.join("");
  const needsNewline = snapshot.units.length === 0 && last !== "none" && !snapshot.tail.endsWith("\n");
  return out.join("") + snapshot.tail + (needsNewline ? eol : "");
}

/** Index ranges [a, b] of segments that reopen with a different top-level
 * structure than the nodes they stand for because a re-serialized run fuses
 * with a neighbour. The run is checked with the visible verbatim block before
 * it and, separately, the one after it, so only a neighbour that really fuses
 * gets re-written. */
function brokenRegions<N>(
  codec: MarkdownCodec<N>,
  snapshot: Snapshot<N>,
  current: readonly N[],
  segments: readonly Segment<N>[],
  parse: (src: string) => N[],
  order: Order<N>,
  gaps: Order<N> | null,
): [number, number][] {
  const reopensSame = (a: number, b: number) => {
    const region = segments.slice(a, b + 1);
    const got = parse(render(codec, snapshot, current, region, false, gaps));
    const expected = current.slice(region[0]!.from, region[region.length - 1]!.to).filter((n) => !isBlank(codec, n));
    return got.length === expected.length && got.every((n, x) => codec.typeOf(n) === codec.typeOf(expected[x]!));
  };
  const isVisibleVerbatim = (s: Segment<N> | undefined): s is Extract<Segment<N>, { kind: "verbatim" }> => s?.kind === "verbatim" && s.unit.nodes.length > 0;

  const broken: [number, number][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.kind !== "fresh") continue;
    let j = i;
    while (segments[j + 1]?.kind === "fresh") j++;
    if (!reopensSame(i, j)) {
      // Pieces of the run, written separately, may fuse with each other: write
      // them as one. A single piece that fails on its own is the editor's
      // limit, not a fusion, and re-writing neighbours would only spread it.
      if (j > i) broken.push([i, j]);
    } else {
      if (isVisibleVerbatim(segments[i - 1]) && !reopensSame(i - 1, j)) broken.push([i - 1, j]);
      if (isVisibleVerbatim(segments[j + 1]) && !reopensSame(i, j + 1)) broken.push([i, j + 1]);
    }
    i = j;
  }
  // Blocks copied from the source that now stand together without having stood together (one was moved, or a
  // block between them was taken away) may fuse as well: two lists with the same marker become one.
  let before = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    // Nothing is written for a piece with no nodes.
    if (seg.kind === "fresh" && seg.from === seg.to) continue;
    if (!isVisibleVerbatim(seg)) {
      before = -1;
      continue;
    }
    const prev = segments[before];
    if (prev && isVisibleVerbatim(prev) && order.get(seg.unit) !== (order.get(prev.unit) ?? -2) + 1 && !reopensSame(before, i)) broken.push([before, i]);
    before = i;
  }
  return broken;
}

/** Re-serializes each broken region as one piece, so the serializer sees the
 * blocks side by side. Overlapping regions merge first. The next pass checks
 * the merged piece against its own new neighbours. */
function widen<N>(segments: readonly Segment<N>[], broken: readonly [number, number][]): Segment<N>[] {
  const merged: [number, number][] = [];
  for (const [a, b] of [...broken].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const out = [...segments];
  // Right to left, so earlier indices stay valid.
  for (const [a, b] of merged.reverse()) {
    const first = out[a]!;
    const gap = first.kind === "verbatim" ? first.unit.gap : first.gap;
    out.splice(a, b - a + 1, { kind: "fresh", gap, from: first.from, to: out[b]!.to });
  }
  return out;
}

/** Re-serialized text must never touch its neighbour: a paragraph that used
 * to be a heading would otherwise merge into the next line. */
function ensureBlankLine(gap: string, eol: string): string {
  const breaks = gap.match(/\r?\n/g)?.length ?? 0;
  if (breaks >= 2) return gap;
  return gap + eol.repeat(2 - breaks);
}
