// The force layout: nodes repel each other (Barnes-Hut over a quadtree, so a
// big graph costs n log n a step), links pull their two ends to a rest length,
// and a weak pull toward the middle keeps separate islands from drifting off.
// It cools like a simulated anneal: the heat falls each step, the nodes slow
// with it, and after a fixed number of steps it stops, whatever the shape, so a
// graph always settles. Given a seed it is deterministic: the same graph gives
// the same picture. Runs in a Web Worker (sim.worker.ts); this file is plain
// code so it can be tested and reused.
//
// Notes with no links at all ("orphans") take no part in the simulation, which
// would push them out to a loose ring round the graph. They are packed instead
// into one island of a sunflower spiral beside it. An orphan that already has a
// place (the places a graph was last left in) keeps it exactly; a new one takes
// the nearest free slot, so adding or removing a note never shuffles the rest.

import { QuadTree } from "./quadtree";

export interface LayoutOptions {
  /** Starts the random jitter; the same seed and graph give the same layout. */
  seed?: number;
  /** x, y pairs to start from (NaN where a node has none): where a graph was last left. */
  start?: ArrayLike<number> | null;
  /** The step budget: the layout stops after this many however it looks. */
  ticks?: number;
  /** How hot it starts, 0 to 1: a layout that starts from known places needs less. */
  heat?: number;
}

const HEAT_FLOOR = 0.001;
const LINK_DISTANCE = 30;
const CHARGE = 30;
const THETA = 0.9;
/** For graphs of thousands of nodes, where the picture is read from afar. */
const THETA_BIG = 1.2;
const VELOCITY_KEPT = 0.6;
const GRAVITY = 0.06;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The island of orphans: the spiral's scale (its slots are about 1.8 of this apart), the gap kept between it and the linked graph, and how near to a placed orphan a slot may not be. */
const ISLAND_STEP = 9.6;
const ISLAND_GAP = 30;
const SLOT_CLEAR = 12.8;

/** A small seeded random number generator: 0 up to 1. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Layout {
  readonly x: Float64Array;
  readonly y: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly from: Int32Array;
  private readonly to: Int32Array;
  /** Each link's pull, and how much of it falls on its source end. */
  private readonly strength: Float64Array;
  private readonly bias: Float64Array;
  private readonly tree: QuadTree;
  /** The nodes with at least one link: the ones the simulation moves. */
  private readonly linked: Int32Array;
  /** Their places, packed together, which is what the tree is built over. */
  private readonly lx: Float64Array;
  private readonly ly: Float64Array;
  /** Orphans: nodes with no link. And those of them that arrived with a place, which they keep. */
  private readonly orphan: Uint8Array;
  private readonly kept: Uint8Array;
  /** The push on one body from the rest, as the tree gives it. */
  private readonly push = new Float64Array(2);
  /** How near a cell must be to be looked into: bigger graphs are a little less exact. */
  private readonly theta: number;
  private readonly rand: () => number;
  private readonly decay: number;
  private heat: number;
  private ran = 0;
  private readonly budget: number;

  /** `edges` holds source and target indices in pairs. */
  constructor(
    readonly count: number,
    edges: ArrayLike<number>,
    options: LayoutOptions = {},
  ) {
    this.budget = Math.max(1, options.ticks ?? 300);
    this.theta = count > 3000 ? THETA_BIG : THETA;
    this.heat = Math.min(1, Math.max(0, options.heat ?? 1));
    this.decay = 1 - Math.pow(HEAT_FLOOR, 1 / this.budget);
    this.rand = random(options.seed ?? 1);
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);

    const links = Math.floor(edges.length / 2);
    this.from = new Int32Array(links);
    this.to = new Int32Array(links);
    const degree = new Int32Array(count);
    for (let e = 0; e < links; e++) {
      this.from[e] = edges[2 * e]!;
      this.to[e] = edges[2 * e + 1]!;
      degree[this.from[e]!]!++;
      degree[this.to[e]!]!++;
    }
    this.orphan = new Uint8Array(count);
    this.kept = new Uint8Array(count);
    const linked: number[] = [];
    for (let i = 0; i < count; i++) {
      if (degree[i] === 0) this.orphan[i] = 1;
      else linked.push(i);
    }
    this.linked = Int32Array.from(linked);
    this.lx = new Float64Array(linked.length);
    this.ly = new Float64Array(linked.length);
    this.tree = new QuadTree(linked.length);
    this.strength = new Float64Array(links);
    this.bias = new Float64Array(links);
    for (let e = 0; e < links; e++) {
      const [s, t] = [degree[this.from[e]!]!, degree[this.to[e]!]!];
      this.strength[e] = 1 / Math.min(s, t);
      this.bias[e] = s / (s + t);
    }
    this.place(options.start ?? null);
    this.pack();
  }

  /** Puts each node where it was, else next to the nodes it links that have a place, else on a spiral. */
  private place(start: ArrayLike<number> | null): void {
    const placed = new Uint8Array(this.count);
    if (start) {
      for (let i = 0; i < this.count; i++) {
        const [px, py] = [start[2 * i], start[2 * i + 1]];
        if (px !== undefined && py !== undefined && Number.isFinite(px) && Number.isFinite(py)) {
          this.x[i] = px;
          this.y[i] = py;
          placed[i] = 1;
          if (this.orphan[i]) this.kept[i] = 1;
        }
      }
    }
    // A new node starts at the middle of its placed neighbours, a little off.
    const sumX = new Float64Array(this.count);
    const sumY = new Float64Array(this.count);
    const seen = new Int32Array(this.count);
    const note = (a: number, b: number) => {
      if (!placed[b]) return;
      sumX[a]! += this.x[b]!;
      sumY[a]! += this.y[b]!;
      seen[a]!++;
    };
    if (start) {
      for (let e = 0; e < this.from.length; e++) {
        note(this.from[e]!, this.to[e]!);
        note(this.to[e]!, this.from[e]!);
      }
    }
    for (let i = 0; i < this.count; i++) {
      if (placed[i]) continue;
      if (seen[i]! > 0) {
        this.x[i] = sumX[i]! / seen[i]! + (this.rand() - 0.5) * LINK_DISTANCE;
        this.y[i] = sumY[i]! / seen[i]! + (this.rand() - 0.5) * LINK_DISTANCE;
      } else {
        const radius = 10 * Math.sqrt(0.5 + i);
        const angle = i * GOLDEN;
        this.x[i] = radius * Math.cos(angle);
        this.y[i] = radius * Math.sin(angle);
      }
    }
  }

  /** Whether the layout has stopped: cooled, or out of steps. */
  get settled(): boolean {
    return this.heat < HEAT_FLOOR || this.ran >= this.budget;
  }

  get steps(): number {
    return this.ran;
  }

  /** One step; true once the layout has settled. */
  step(): boolean {
    if (this.settled) return true;
    this.ran++;
    this.heat += (0 - this.heat) * this.decay;
    const { x, y, vx, vy, heat } = this;

    for (let e = 0; e < this.from.length; e++) {
      const [s, t] = [this.from[e]!, this.to[e]!];
      let dx = x[t]! + vx[t]! - x[s]! - vx[s]!;
      let dy = y[t]! + vy[t]! - y[s]! - vy[s]!;
      if (dx === 0) dx = (this.rand() - 0.5) * 1e-6;
      if (dy === 0) dy = (this.rand() - 0.5) * 1e-6;
      const length = Math.sqrt(dx * dx + dy * dy);
      const pull = ((length - LINK_DISTANCE) / length) * heat * this.strength[e]!;
      dx *= pull;
      dy *= pull;
      const b = this.bias[e]!;
      vx[t]! -= dx * b;
      vy[t]! -= dy * b;
      vx[s]! += dx * (1 - b);
      vy[s]! += dy * (1 - b);
    }

    // Only the linked nodes are simulated (orphans are packed apart, see `pack`): the tree holds them alone.
    const { linked, lx, ly } = this;
    const moving = linked.length;
    for (let j = 0; j < moving; j++) {
      lx[j] = x[linked[j]!]!;
      ly[j] = y[linked[j]!]!;
    }
    this.tree.build(lx, ly, moving);
    const { push, theta } = this;
    const away = -CHARGE * heat;
    for (let j = 0; j < moving; j++) {
      const body = linked[j]!;
      this.tree.pushOn(j, lx[j]!, ly[j]!, theta, push);
      vx[body]! += push[0]! * away;
      vy[body]! += push[1]! * away;
    }

    let meanX = 0;
    let meanY = 0;
    for (let j = 0; j < moving; j++) {
      const i = linked[j]!;
      vx[i]! -= x[i]! * GRAVITY * heat;
      vy[i]! -= y[i]! * GRAVITY * heat;
      vx[i]! *= VELOCITY_KEPT;
      vy[i]! *= VELOCITY_KEPT;
      x[i]! += vx[i]!;
      y[i]! += vy[i]!;
      meanX += x[i]!;
      meanY += y[i]!;
    }
    if (moving > 0) {
      meanX /= moving;
      meanY /= moving;
      for (let j = 0; j < moving; j++) {
        x[linked[j]!]! -= meanX;
        y[linked[j]!]! -= meanY;
      }
    }
    // Once the graph has its shape, the orphans that have no place yet are laid beside it.
    if (this.settled) this.pack();
    return this.settled;
  }

  /**
   * Lays the orphans that arrived without a place in one island beside the linked graph: a sunflower spiral, its middle as far from
   * the graph's middle as the graph reaches plus a gap and the island's own radius. A slot within reach of an orphan that keeps its
   * place is skipped. The graph itself is not moved, so nothing already placed ever is.
   */
  private pack(): void {
    const { x, y, orphan, kept, linked } = this;
    const fresh: number[] = [];
    let all = 0;
    for (let i = 0; i < this.count; i++) {
      if (!orphan[i]) continue;
      all++;
      if (!kept[i]) fresh.push(i);
    }
    if (fresh.length === 0) return;
    let reach = 0;
    for (let j = 0; j < linked.length; j++) reach = Math.max(reach, Math.hypot(x[linked[j]!]!, y[linked[j]!]!));
    // The island is as wide as all the orphans make it, whether placed already or not; with nothing linked it is round the middle.
    const middle = linked.length === 0 ? 0 : reach + ISLAND_GAP + ISLAND_STEP * Math.sqrt(all);
    // Where the orphans that keep their place are, by cell, so a slot can be checked against its neighbours alone.
    const cell = (v: number) => Math.floor(v / SLOT_CLEAR);
    const taken = new Map<string, [number, number][]>();
    const note = (px: number, py: number) => {
      const key = `${cell(px)},${cell(py)}`;
      const here = taken.get(key);
      if (here) here.push([px, py]);
      else taken.set(key, [[px, py]]);
    };
    for (let i = 0; i < this.count; i++) if (orphan[i] && kept[i]) note(x[i]!, y[i]!);
    const free = (px: number, py: number) => {
      for (let gx = cell(px) - 1; gx <= cell(px) + 1; gx++) {
        for (let gy = cell(py) - 1; gy <= cell(py) + 1; gy++) {
          if (taken.get(`${gx},${gy}`)?.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < SLOT_CLEAR)) return false;
        }
      }
      return true;
    };
    let slot = 0;
    for (const i of fresh) {
      for (;;) {
        const radius = ISLAND_STEP * Math.sqrt(slot);
        const angle = slot * GOLDEN;
        slot++;
        const [px, py] = [middle + radius * Math.cos(angle), radius * Math.sin(angle)];
        if (!free(px, py)) continue;
        x[i] = px;
        y[i] = py;
        note(px, py);
        break;
      }
    }
  }

  /** The places as x, y pairs, ready to send or draw. */
  positions(): Float32Array {
    const out = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      out[2 * i] = this.x[i]!;
      out[2 * i + 1] = this.y[i]!;
    }
    return out;
  }
}

/** Runs a layout to the end. For small graphs and tests; the view runs it in a worker, a few steps at a time. */
export function settle(count: number, edges: ArrayLike<number>, options: LayoutOptions = {}): Float32Array {
  const layout = new Layout(count, edges, options);
  while (!layout.step());
  return layout.positions();
}
