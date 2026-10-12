// A point quadtree in typed arrays. The force layout reads it as a
// Barnes-Hut tree (a far cell stands in for the bodies in it, as one body at
// their centre of mass), and the canvas asks it for the node nearest the
// pointer. Rebuilt from the positions each time they move; nothing is
// allocated per body.

const NONE = -1;
/** A leaf that holds several bodies at (nearly) one place. */
const MANY = -2;
/** Deepest cell: bodies closer than the root's size over 2^MAX_DEPTH share a leaf. */
const MAX_DEPTH = 28;

export class QuadTree {
  private capacity: number;
  /** Cell centre and half the cell's side. */
  private cx: Float64Array;
  private cy: Float64Array;
  private half: Float64Array;
  /** Bodies in the cell, and the sums of their positions (centre of mass = sum / mass). */
  private mass: Float64Array;
  private sx: Float64Array;
  private sy: Float64Array;
  /** Four children per cell, or NONE. */
  private kid: Int32Array;
  /** The one body of a leaf, MANY for a leaf with several, NONE for a cell with children or none. */
  private body: Int32Array;
  private used = 0;
  private xs: ArrayLike<number> = [];
  private ys: ArrayLike<number> = [];
  /** Cells still to look at, kept between calls (a walk of this tree never holds more than a few dozen). */
  private readonly pile: number[] = [];
  private readonly lane = new Int32Array(512);

  constructor(bodies: number) {
    this.capacity = Math.max(16, bodies * 4 + 16);
    this.cx = new Float64Array(this.capacity);
    this.cy = new Float64Array(this.capacity);
    this.half = new Float64Array(this.capacity);
    this.mass = new Float64Array(this.capacity);
    this.sx = new Float64Array(this.capacity);
    this.sy = new Float64Array(this.capacity);
    this.kid = new Int32Array(this.capacity * 4).fill(NONE);
    this.body = new Int32Array(this.capacity).fill(NONE);
  }

  /** Builds the tree over bodies `0..count` at (`x[i]`, `y[i]`). */
  build(x: ArrayLike<number>, y: ArrayLike<number>, count: number): void {
    this.xs = x;
    this.ys = y;
    this.used = 0;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const px = x[i]!;
      const py = y[i]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (count === 0) return;
    const half = Math.max(maxX - minX, maxY - minY, 1) / 2 + 1;
    this.cell((minX + maxX) / 2, (minY + maxY) / 2, half);
    for (let i = 0; i < count; i++) this.insert(i);
  }

  private cell(cx: number, cy: number, half: number): number {
    if (this.used >= this.capacity) this.grow();
    const node = this.used++;
    this.cx[node] = cx;
    this.cy[node] = cy;
    this.half[node] = half;
    this.mass[node] = 0;
    this.sx[node] = 0;
    this.sy[node] = 0;
    this.body[node] = NONE;
    this.kid.fill(NONE, node * 4, node * 4 + 4);
    return node;
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    const widen = (a: Float64Array) => {
      const next = new Float64Array(capacity);
      next.set(a);
      return next;
    };
    this.cx = widen(this.cx);
    this.cy = widen(this.cy);
    this.half = widen(this.half);
    this.mass = widen(this.mass);
    this.sx = widen(this.sx);
    this.sy = widen(this.sy);
    const kid = new Int32Array(capacity * 4).fill(NONE);
    kid.set(this.kid);
    this.kid = kid;
    const body = new Int32Array(capacity).fill(NONE);
    body.set(this.body);
    this.body = body;
    this.capacity = capacity;
  }

  /** The child of `node` that holds (x, y), made if it is not there yet. */
  private child(node: number, x: number, y: number): number {
    const quadrant = (x >= this.cx[node]! ? 1 : 0) + (y >= this.cy[node]! ? 2 : 0);
    const at = node * 4 + quadrant;
    let found = this.kid[at]!;
    if (found === NONE) {
      const half = this.half[node]! / 2;
      found = this.cell(this.cx[node]! + (quadrant & 1 ? half : -half), this.cy[node]! + (quadrant & 2 ? half : -half), half);
      this.kid[at] = found;
    }
    return found;
  }

  private insert(i: number): void {
    const x = this.xs[i]!;
    const y = this.ys[i]!;
    let node = 0;
    for (let depth = 0; ; depth++) {
      const before = this.mass[node]!;
      this.mass[node] = before + 1;
      this.sx[node] = this.sx[node]! + x;
      this.sy[node] = this.sy[node]! + y;
      if (before === 0) {
        this.body[node] = i;
        return;
      }
      const resident = this.body[node]!;
      if (resident !== NONE) {
        // A leaf: bodies at one place (or too deep to tell apart) share it.
        const same = resident >= 0 && this.xs[resident] === x && this.ys[resident] === y;
        if (resident === MANY || same || depth >= MAX_DEPTH) {
          this.body[node] = MANY;
          return;
        }
        // Otherwise the resident moves down a level and this one follows.
        this.body[node] = NONE;
        const moved = this.child(node, this.xs[resident]!, this.ys[resident]!);
        this.mass[moved] = 1;
        this.sx[moved] = this.xs[resident]!;
        this.sy[moved] = this.ys[resident]!;
        this.body[moved] = resident;
      }
      node = this.child(node, x, y);
    }
  }

  /**
   * Calls `visit(mass, centreX, centreY)` for what stands in for the other
   * bodies as seen from body `self` at (x, y): a whole cell when it is far
   * enough (its side over its distance under `theta`), else what is in it.
   * `reach` stops short of cells farther than that.
   */
  forEachNear(self: number, x: number, y: number, theta: number, reach: number, visit: (mass: number, cx: number, cy: number) => void): void {
    if (this.used === 0) return;
    const stack = this.pile;
    stack.length = 0;
    stack.push(0);
    const limit = theta * theta;
    while (stack.length > 0) {
      const node = stack.pop()!;
      const mass = this.mass[node]!;
      if (mass === 0) continue;
      const resident = this.body[node]!;
      const dx = this.sx[node]! / mass - x;
      const dy = this.sy[node]! / mass - y;
      const d2 = dx * dx + dy * dy;
      if (resident !== NONE) {
        // A leaf; the body itself exerts nothing on itself.
        if (resident === self) continue;
        if (d2 <= reach * reach) visit(resident === MANY ? mass : 1, x + dx, y + dy);
        continue;
      }
      const side = this.half[node]! * 2;
      if (side * side < limit * d2) {
        if (d2 <= reach * reach) visit(mass, x + dx, y + dy);
        continue;
      }
      // Too close to stand in for: look at the children, unless the whole cell is out of reach.
      const margin = reach + side;
      if (d2 > margin * margin) continue;
      for (let q = 0; q < 4; q++) {
        const child = this.kid[node * 4 + q]!;
        if (child !== NONE) stack.push(child);
      }
    }
  }

  /**
   * The push on body `self` at (x, y) from all the others, as the layout
   * wants it: the sum of mass × (dx, dy) / d² over what stands in for them,
   * d being at least 1 so near neighbours do not fling each other off.
   * Written to `out[0]` and `out[1]`; the caller sets the strength. A loop
   * with no callback, since it runs once for every body on every step.
   */
  pushOn(self: number, x: number, y: number, theta: number, out: Float64Array): void {
    let fx = 0;
    let fy = 0;
    if (this.used > 0) {
      const { mass, sx, sy, half, kid, body, lane } = this;
      const limit = theta * theta;
      let top = 0;
      lane[top++] = 0;
      while (top > 0) {
        const node = lane[--top]!;
        const m = mass[node]!;
        if (m === 0) continue;
        const resident = body[node]!;
        let dx = sx[node]! / m - x;
        let dy = sy[node]! / m - y;
        let d2 = dx * dx + dy * dy;
        if (resident !== NONE) {
          // A leaf; a body pushes nothing on itself.
          if (resident === self) continue;
          if (d2 === 0) {
            // Bodies at one place are pulled apart in a direction of their own.
            dx = self % 2 === 0 ? 1e-3 : -1e-3;
            dy = self % 3 === 0 ? 1e-3 : -1e-3;
            d2 = 1;
          }
          const w = (resident === MANY ? m : 1) / Math.max(1, d2);
          fx += dx * w;
          fy += dy * w;
          continue;
        }
        const side = half[node]! * 2;
        if (side * side < limit * d2) {
          const w = m / Math.max(1, d2);
          fx += dx * w;
          fy += dy * w;
          continue;
        }
        const first = node * 4;
        for (let q = 0; q < 4; q++) {
          const child = kid[first + q]!;
          if (child !== NONE) lane[top++] = child;
        }
      }
    }
    out[0] = fx;
    out[1] = fy;
  }

  /** The body nearest (x, y) within `radius`, or -1. */
  nearest(x: number, y: number, radius: number): number {
    if (this.used === 0) return -1;
    let best = -1;
    let bestD2 = radius * radius;
    const stack = this.pile;
    stack.length = 0;
    stack.push(0);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (this.mass[node] === 0) continue;
      // The cell's nearest point to (x, y) is past the best so far.
      const half = this.half[node]!;
      const gapX = Math.max(0, Math.abs(x - this.cx[node]!) - half);
      const gapY = Math.max(0, Math.abs(y - this.cy[node]!) - half);
      if (gapX * gapX + gapY * gapY > bestD2) continue;
      const resident = this.body[node]!;
      if (resident >= 0) {
        const dx = this.xs[resident]! - x;
        const dy = this.ys[resident]! - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) [best, bestD2] = [resident, d2];
        continue;
      }
      if (resident === MANY) {
        // Bodies at one place: found by the caller's own list if it must tell them apart.
        const dx = this.sx[node]! / this.mass[node]! - x;
        const dy = this.sy[node]! / this.mass[node]! - y;
        if (dx * dx + dy * dy <= bestD2) best = this.firstAt(node);
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const child = this.kid[node * 4 + q]!;
        if (child !== NONE) stack.push(child);
      }
    }
    return best;
  }

  /** A body in a shared leaf: found by position, as the leaf keeps none of its own. */
  private firstAt(node: number): number {
    const cx = this.sx[node]! / this.mass[node]!;
    const cy = this.sy[node]! / this.mass[node]!;
    let found = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      const dx = this.xs[i]! - cx;
      const dy = this.ys[i]! - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) [found, bestD2] = [i, d2];
    }
    return found;
  }
}
