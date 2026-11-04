// Turning what is on the slide into the plain boxes the canvas package works with.

import { type Item, type Point, hitStack, hitTest, rotatePoint } from "@kasten-slides/canvas";
import type { Element, Side } from "@kasten-slides/wasm";

import { type Pt, routePath } from "../../render/lines/route.ts";
import type { EditorSession } from "../session/session.ts";

/** The boxes last worked out for a list of elements: the engine hands out the same list until something in it changes, so the pointer moving over a slide asks once. */
const worked = new WeakMap<readonly Element[], { theme: object; layout: string; items: Item[] }>();

/** Points along a curve's cubic, enough that a click near it is found within a pixel or two. */
const CURVE_STEPS = 16;

/** The points a line or connector is drawn through, in slide units: its route in the box, mirrored by the flips (the box is turned later, by the hit test). */
function pathOf(element: Extract<Element, { type: "line" | "connector" }>, box: { x: number; y: number; w: number; h: number }): Point[] {
  const route = routePath(element.route, box.w, box.h);
  const place = ([x, y]: Pt): Point => ({ x: box.x + (element.flipH ? box.w - x : x), y: box.y + (element.flipV ? box.h - y : y) });
  const points: Point[] = [place(route.start)];
  let from = route.start;
  for (const seg of route.segs) {
    if (seg.control) {
      const [c1, c2] = seg.control;
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        const mix = (k: 0 | 1): number => u * u * u * from[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * seg.to[k];
        points.push(place([mix(0), mix(1)]));
      }
    } else points.push(place(seg.to));
    from = seg.to;
  }
  return points;
}

/** The boxes of some elements, back to front. Elements with no box (a layout without the slot) are left out. The list must not be changed by the caller. */
export function itemsOfList(session: EditorSession, list: readonly Element[]): Item[] {
  const { theme } = session.deck;
  const layout = session.slide.layout;
  const known = worked.get(list);
  if (known && known.theme === theme && known.layout === layout) return known.items;
  const items: Item[] = [];
  for (const element of list) {
    const box = session.elements.boxOf(element);
    if (!box) continue;
    const path = element.type === "line" || element.type === "connector" ? pathOf(element, box) : undefined;
    items.push({ id: element.id, ...box, rotation: element.rotation ?? 0, locked: element.locked ?? false, ...(path ? { path } : {}) });
  }
  worked.set(list, { theme, layout, items });
  return items;
}

/** The boxes of the elements the person works among (the slide's own, or what the group they went into holds), back to front. */
export function itemsOf(session: EditorSession): Item[] {
  return itemsOfList(session, session.scope);
}

/**
 * The topmost element at a point, with a margin that keeps thin lines easy to hit at any zoom. A locked element is found too (a click
 * selects it, so it can be unlocked); what a press does with it is the controller's business.
 */
export function hitAt(items: readonly Item[], point: Point, zoom: number): string | null {
  return hitTest(items, point, { tolerance: 3 / zoom, includeLocked: true });
}

/** Every element at a point, the topmost first: what a repeated click and "Select behind" step through. */
export function stackAt(items: readonly Item[], point: Point, zoom: number): string[] {
  return hitStack(items, point, { tolerance: 3 / zoom, includeLocked: true });
}

/** Where on an element a connector can attach: the middle of each side. */
export function sitePoint(item: Item, side: Side): Point {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const at = { left: { x: item.x, y: cy }, right: { x: item.x + item.w, y: cy }, top: { x: cx, y: item.y }, bottom: { x: cx, y: item.y + item.h } }[side];
  return rotatePoint(at, { x: cx, y: cy }, item.rotation ?? 0);
}

export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

export interface Site {
  id: string;
  side: Side;
  point: Point;
}

/** The connection site nearest a point within `reach`, on any element that can hold a connector's end. */
export function nearestSite(items: readonly Item[], elements: readonly Element[], point: Point, reach: number, skip: ReadonlySet<string> = new Set()): Site | null {
  const holders = new Set(elements.filter((e) => e.type !== "line" && e.type !== "connector").map((e) => e.id));
  let best: (Site & { distance: number }) | null = null;
  for (const item of items) {
    if (!holders.has(item.id) || skip.has(item.id)) continue;
    for (const side of SIDES) {
      const site = sitePoint(item, side);
      const distance = Math.hypot(site.x - point.x, site.y - point.y);
      if (distance <= reach && (!best || distance < best.distance)) best = { id: item.id, side, point: site, distance };
    }
  }
  return best ? { id: best.id, side: best.side, point: best.point } : null;
}
