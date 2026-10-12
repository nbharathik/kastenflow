// The graph's view: where the picture is panned and how far it is zoomed.
// Pure, so the arithmetic is tested apart from the canvas. A point at (wx, wy)
// in graph units is drawn at (wx × k + x, wy × k + y) on the canvas.

export interface Camera {
  x: number;
  y: number;
  /** Pixels per graph unit. */
  k: number;
}

export const MIN_ZOOM = 0.03;
export const MAX_ZOOM = 6;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export const toScreen = (cam: Camera, wx: number, wy: number): [number, number] => [wx * cam.k + cam.x, wy * cam.k + cam.y];

export const toWorld = (cam: Camera, sx: number, sy: number): [number, number] => [(sx - cam.x) / cam.k, (sy - cam.y) / cam.k];

/** Zooms by `factor` about the screen point (sx, sy), which stays where it is. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const k = clampZoom(cam.k * factor);
  const [wx, wy] = toWorld(cam, sx, sy);
  return { k, x: sx - wx * k, y: sy - wy * k };
}

export const panBy = (cam: Camera, dx: number, dy: number): Camera => ({ ...cam, x: cam.x + dx, y: cam.y + dy });

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box round x, y pairs (the first `count`), or null with none. */
export function boundsOf(positions: ArrayLike<number>, count: number): Bounds | null {
  if (count === 0) return null;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < count; i++) {
    const [x, y] = [positions[2 * i]!, positions[2 * i + 1]!];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
  }
  return box.minX === Infinity ? null : box;
}

/** The camera that shows `box` whole in a canvas of `width` × `height`, with `pad` pixels round it, never closer than `maxZoom`. */
export function fitBounds(box: Bounds | null, width: number, height: number, pad = 48, maxZoom = 1.6): Camera {
  if (!box || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  const [w, h] = [Math.max(box.maxX - box.minX, 1), Math.max(box.maxY - box.minY, 1)];
  const k = clampZoom(Math.min(maxZoom, (width - 2 * pad) / w, (height - 2 * pad) / h));
  return { k, x: width / 2 - ((box.minX + box.maxX) / 2) * k, y: height / 2 - ((box.minY + box.maxY) / 2) * k };
}

/** The camera with graph point (wx, wy) in the middle of the canvas, at zoom `k` (the same if left out). */
export function centreOn(cam: Camera, wx: number, wy: number, width: number, height: number, k = cam.k): Camera {
  const zoom = clampZoom(k);
  return { k: zoom, x: width / 2 - wx * zoom, y: height / 2 - wy * zoom };
}

/** A camera partway (0 to 1) between two. The zoom moves by ratio, so a zoom out feels as quick as a zoom in. */
export function between(from: Camera, to: Camera, t: number): Camera {
  const k = from.k * Math.pow(to.k / from.k, t);
  // The point in the middle of the canvas moves in a straight line; the offsets follow the zoom.
  return { k, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
