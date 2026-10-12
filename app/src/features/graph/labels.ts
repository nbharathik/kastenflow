// Which nodes get a name drawn beside them: the ones that matter at this
// zoom (more links, or under the pointer), and no two names on top of each
// other. A name that would overlap one already placed is left out, so a busy
// graph reads as a few clear names rather than a smear.

export interface Candidate {
  index: number;
  /** Where the node is on the canvas, and its radius there. */
  x: number;
  y: number;
  r: number;
  text: string;
  /** Higher is placed first; a name of `force` priority is drawn whatever it covers. */
  priority: number;
  /** Always drawn: the node under the pointer, its neighbours, the selected one. */
  force?: boolean;
}

export interface Placed {
  index: number;
  /** Where the text's middle starts and its baseline. */
  x: number;
  y: number;
  text: string;
  force: boolean;
}

/** Room a name takes: its width and its height in pixels. */
const HEIGHT = 15;
const GAP = 2;
/** Room left between a name and the canvas's edge. */
const EDGE = 4;
/** Most names drawn at once. */
const MAX_NAMES = 220;
const CELL = 64;

/**
 * The names to draw, in priority order, each below its node. `measure` gives a
 * text's width. Names off the canvas are left out.
 */
export function placeLabels(candidates: readonly Candidate[], width: number, height: number, measure: (text: string) => number, max = MAX_NAMES): Placed[] {
  const sorted = [...candidates].sort((a, b) => Number(Boolean(b.force)) - Number(Boolean(a.force)) || b.priority - a.priority || a.index - b.index);
  const taken = new Map<number, [number, number, number, number][]>();
  const cellsOf = (x0: number, y0: number, x1: number, y1: number) => {
    const keys: number[] = [];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) keys.push(cx * 100003 + cy);
    return keys;
  };
  const out: Placed[] = [];
  for (const c of sorted) {
    if (out.length >= max && !c.force) break;
    const w = measure(c.text);
    const [centred, y0] = [c.x - w / 2, c.y + c.r + GAP];
    if (centred + w < 0 || y0 + HEIGHT < 0 || centred > width || y0 > height) continue;
    // A name that would be cut by the canvas's edge slides in, so it can be read whole.
    const x0 = w + 2 * EDGE <= width ? Math.min(Math.max(centred, EDGE), width - w - EDGE) : centred;
    const [x1, y1] = [x0 + w, y0 + HEIGHT];
    const keys = cellsOf(x0, y0, x1, y1);
    const clash = keys.some((key) => taken.get(key)?.some(([a, b, c2, d]) => x0 < c2 && x1 > a && y0 < d && y1 > b));
    if (clash && !c.force) continue;
    for (const key of keys) {
      const list = taken.get(key);
      if (list) list.push([x0, y0, x1, y1]);
      else taken.set(key, [[x0, y0, x1, y1]]);
    }
    out.push({ index: c.index, x: x0, y: y0 + HEIGHT - 4, text: c.text, force: Boolean(c.force) });
  }
  return out;
}
