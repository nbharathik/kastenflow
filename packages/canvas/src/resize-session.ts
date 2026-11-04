// Dragging a handle: resize one item, or several as if they were one.

import type { Point, Rect } from "./geometry.ts";
import { normaliseAngle } from "./geometry.ts";
import type { Box, Item } from "./items.ts";
import { boundsOf, selectionBounds } from "./items.ts";
import type { Mods } from "./modifiers.ts";
import { snapResize } from "./snap.ts";
import type { Frame, Guide } from "./snap.ts";
import { tidy } from "./tidy.ts";
import { handlePoints, mirrorHandle, mirrorWithin, resizeBox, scaleWithin } from "./transform.ts";
import type { Handle, ResizeOutcome } from "./transform.ts";

export interface ResizeStart {
  /** The items being resized: one is resized with resizeBox, several as one box with scaleWithin. */
  items: readonly Item[];
  handle: Handle;
  /** Everything on the slide: what is not being resized is what the drag snaps to. */
  all: readonly Item[];
  frame: Frame;
  /** Where the pointer went down. Left out, the drag is taken to have begun on the handle itself. */
  grabbed?: Point;
  /** How near a guide must be to snap to it, in slide units. Default 6. */
  snapThreshold?: number;
  /**
   * The proportions are kept unless Shift is held (a picture, a video: they are never meant to be squashed). Left out, the
   * reverse holds: Shift keeps them.
   */
  keepByDefault?: boolean;
}

export interface ResizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  /** Present, and true, when the drag went past the opposite edge: the item is mirrored left to right. */
  flipH?: boolean;
  flipV?: boolean;
}

export interface ResizePreview {
  boxes: Map<string, ResizedBox>;
  guides: Guide[];
}

export interface ResizeResult {
  boxes: Map<string, ResizedBox>;
  /** false when nothing differs from how it began, so there is nothing to commit. */
  changed: boolean;
}

/** An edge this close to a line is on it: used to see which guides the finished box really touches. */
const ON_A_LINE = 1e-6;

const SAME = 1e-9;

const boxOf = (b: Box, flipH: boolean, flipV: boolean): ResizedBox => {
  const out: ResizedBox = { x: tidy(b.x), y: tidy(b.y), w: tidy(b.w), h: tidy(b.h) };
  if (b.rotation !== undefined) out.rotation = tidy(b.rotation);
  if (flipH) out.flipH = true;
  if (flipV) out.flipV = true;
  return out;
};

const same = (a: ResizedBox, b: ResizedBox): boolean =>
  Math.abs(a.x - b.x) < SAME &&
  Math.abs(a.y - b.y) < SAME &&
  Math.abs(a.w - b.w) < SAME &&
  Math.abs(a.h - b.h) < SAME &&
  !a.flipH &&
  !a.flipV &&
  (a.rotation === undefined || b.rotation === undefined ? a.rotation === b.rotation : Math.abs(a.rotation - b.rotation) < SAME);

export class ResizeSession {
  private readonly init: ResizeStart;
  /** What the handle drags: the one item, or the box round all of them. */
  private readonly base: Box | null;
  private readonly grabbed: Point;
  private readonly targets: readonly Rect[];
  private readonly starts: ReadonlyMap<string, ResizedBox>;
  private latest: Map<string, ResizedBox>;

  private constructor(init: ResizeStart, base: Box | null, grabbed: Point, targets: readonly Rect[], starts: ReadonlyMap<string, ResizedBox>) {
    this.init = init;
    this.base = base;
    this.grabbed = grabbed;
    this.targets = targets;
    this.starts = starts;
    this.latest = new Map(starts);
  }

  static start(init: ResizeStart): ResizeSession {
    const resizing = new Set(init.items.map((item) => item.id));
    const only = init.items.length === 1 ? init.items[0] : undefined;
    const base = only ?? selectionBounds(init.items, resizing);
    const grabbed = init.grabbed ?? (base ? handlePoints(base)[init.handle] : { x: 0, y: 0 });
    const targets = init.all.filter((item) => !resizing.has(item.id)).map(boundsOf);
    const starts = new Map(init.items.map((item): [string, ResizedBox] => [item.id, boxOf(item, false, false)]));
    return new ResizeSession(init, base, grabbed, targets, starts);
  }

  update(pointer: Point, mods: Mods = {}): ResizePreview {
    const { base, init } = this;
    if (!base) return { boxes: new Map(), guides: [] };
    const total = { dx: pointer.x - this.grabbed.x, dy: pointer.y - this.grabbed.y };
    // Shift toggles what the drag does with the proportions: it keeps them, or (for a picture) lets them go.
    const keep = init.keepByDefault ? !mods.shift : !!mods.shift;
    const opts = { keepRatio: keep, fromCentre: mods.alt };

    let out = resizeBox(base, init.handle, total, opts);
    let guides: Guide[] = [];
    // A turned item has no upright edges to line up, so only upright boxes snap.
    if (normaliseAngle(base.rotation ?? 0) === 0 && !mods.noSnap) {
      // Past the opposite edge the dragged edge is on the other side of the box.
      const dragged = (o: ResizeOutcome): Handle => mirrorHandle(init.handle, { h: o.flipH, v: o.flipV });
      const snap = snapResize(out.box, dragged(out), this.targets, init.frame, { threshold: init.snapThreshold, keepRatio: keep });
      // Feeding the offset back through resizeBox lets snapping combine with the ratio and the centre.
      if (snap.dx !== 0 || snap.dy !== 0) out = resizeBox(base, init.handle, { dx: total.dx + snap.dx, dy: total.dy + snap.dy }, opts);
      // Asked afresh of the finished box: keeping the ratio can leave one of the edges off its line.
      guides = snapResize(out.box, dragged(out), this.targets, init.frame, { threshold: ON_A_LINE }).guides;
    }

    this.latest = this.boxesFor(base, out);
    return { boxes: new Map(this.latest), guides };
  }

  /** The final boxes, from a last pointer position if one is given, else the last update. */
  end(pointer?: Point, mods?: Mods): ResizeResult {
    if (pointer) this.update(pointer, mods);
    const changed = [...this.latest].some(([id, box]) => {
      const start = this.starts.get(id);
      return !start || !same(box, start);
    });
    return { boxes: this.latest, changed };
  }

  private boxesFor(base: Box, out: ResizeOutcome): Map<string, ResizedBox> {
    const boxes = new Map<string, ResizedBox>();
    const only = this.init.items.length === 1 ? this.init.items[0] : undefined;
    if (only) return boxes.set(only.id, boxOf(out.box, out.flipH, out.flipV));

    // Resized inside out, the group is reflected first and then scaled into the new box.
    const flipped = out.flipH || out.flipV ? mirrorWithin(this.init.items, base, { h: out.flipH, v: out.flipV }) : this.init.items;
    for (const item of scaleWithin(flipped, base, out.box)) boxes.set(item.id, boxOf(item, out.flipH, out.flipV));
    return boxes;
  }
}
