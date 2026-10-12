// The force layout: nodes repel each other (Barnes-Hut over a quadtree, so a
// big graph costs n log n a step), links pull their two ends to a rest length,
// and a weak pull toward the middle keeps unlinked nodes and separate islands
// from drifting off. It cools like a simulated anneal: the heat falls each
// step, the nodes slow with it, and after a fixed number of steps it stops,
// whatever the shape, so a graph always settles. Given a seed it is
// deterministic: the same graph gives the same picture. Runs in a Web Worker
// (sim.worker.ts); this file is plain code so it can be tested and reused.

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
    this.tree = new QuadTree(count);

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
    this.strength = new Float64Array(links);
    this.bias = new Float64Array(links);
    for (let e = 0; e < links; e++) {
      const [s, t] = [degree[this.from[e]!]!, degree[this.to[e]!]!];
      this.strength[e] = 1 / Math.min(s, t);
      this.bias[e] = s / (s + t);
    }
    this.place(options.start ?? null);
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
    const { count, x, y, vx, vy, heat } = this;

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

    this.tree.build(x, y, count);
    const { push, theta } = this;
    const away = -CHARGE * heat;
    for (let body = 0; body < count; body++) {
      this.tree.pushOn(body, x[body]!, y[body]!, theta, push);
      vx[body]! += push[0]! * away;
      vy[body]! += push[1]! * away;
    }

    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < count; i++) {
      vx[i]! -= x[i]! * GRAVITY * heat;
      vy[i]! -= y[i]! * GRAVITY * heat;
      vx[i]! *= VELOCITY_KEPT;
      vy[i]! *= VELOCITY_KEPT;
      x[i]! += vx[i]!;
      y[i]! += vy[i]!;
      meanX += x[i]!;
      meanY += y[i]!;
    }
    if (count > 0) {
      meanX /= count;
      meanY /= count;
      for (let i = 0; i < count; i++) {
        x[i]! -= meanX;
        y[i]! -= meanY;
      }
    }
    return this.settled;
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
