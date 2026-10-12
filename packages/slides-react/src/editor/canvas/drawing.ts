// Drawing with a tool: the box or line a press and drag makes, and the element
// that is put on the slide when the pointer is let go. The controller decides
// when a press is a drawing; what a drawing comes to is here.

import { type Point, type Rect, boundsOf } from "@kasten-slides/canvas";
import type { Element, Route } from "@kasten-slides/wasm";

import { clickBox, line, shape, textBox } from "../factory.ts";
import { markFresh } from "../quick-add/fresh.ts";
import { SNAP, spotAt } from "../quick-add/spot.ts";
import type { EditorSession } from "../session/session.ts";
import { CLICK_SIZE } from "../shapes.ts";
import { itemsOf, nearestSite } from "./geometry.ts";

/** How near a line's end must come to a shape's side to stick to it, in screen pixels. */
export const STICK = 10;
const MIN_DRAW = 4;

/** The box between two points, whichever way they lie. */
export function boxOfPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** A line's box and flips for the points it joins. */
export function lineBox(a: Point, b: Point): Rect & { flipH: boolean; flipV: boolean } {
  const box = boxOfPoints(a, b);
  return { ...box, flipH: b.x < a.x, flipV: b.y < a.y };
}

/** The point at the same distance from `from`, on the nearest 45° line. */
export function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

const isLineTool = (tool: string): boolean => tool.startsWith("line:") || tool.startsWith("arrow:");

/** Where a drawing ends for a pointer at `at`: a line's end sticks to a shape's side near it, or goes in 45° steps with Shift; a box is square with Shift. */
export function drawEnd(session: EditorSession, zoom: number, tool: string, from: Point, at: Point, shift: boolean): Point {
  if (isLineTool(tool)) {
    const site = nearestSite(itemsOf(session), session.scope, at, STICK / zoom);
    return site ? site.point : shift ? snapAngle(from, at) : at;
  }
  if (shift) {
    const size = Math.max(Math.abs(at.x - from.x), Math.abs(at.y - from.y));
    return { x: from.x + Math.sign(at.x - from.x || 1) * size, y: from.y + Math.sign(at.y - from.y || 1) * size };
  }
  return at;
}

/**
 * Where a text box made by a click goes: its top left at the click, as the T key puts it at the pointer, snapped to the edges and
 * middles of what is on the slide as a drag would be (`snap`) and kept inside the slide.
 */
function clickSpot(session: EditorSession, zoom: number, at: Point, size: { w: number; h: number }, snap: boolean): Rect {
  return spotAt(at, size, session.deck.size, snap ? itemsOf(session).map(boundsOf) : [], snap ? SNAP / zoom : null);
}

/**
 * Puts what was drawn on the slide, selected, and gives the pointer back. A text box opens for typing. A click makes a text box
 * with its top left where the pointer was, and a shape of its usual size centred there; a drag makes the box it drew.
 */
export function finishDraw(session: EditorSession, zoom: number, tool: string, from: Point, to: Point, snap = true): void {
  session.setTool("select");
  if (tool === "text" || tool.startsWith("shape:")) {
    const dragged = Math.abs(to.x - from.x) >= MIN_DRAW * 2 || Math.abs(to.y - from.y) >= MIN_DRAW * 2;
    const size = tool === "text" ? CLICK_SIZE.text : CLICK_SIZE.shape;
    const click = tool === "text" ? clickSpot(session, zoom, from, size, snap) : clickBox(from, size);
    const box = dragged ? boxOfPoints(from, to) : click;
    const [id] = session.elements.insert([tool === "text" ? textBox(box) : shape(tool.slice("shape:".length), box)]);
    if (id && tool === "text") {
      markFresh(session, id);
      session.startEditing(id);
    }
  } else {
    insertLine(session, zoom, tool, from, to);
  }
}

function insertLine(session: EditorSession, zoom: number, tool: string, from: Point, to: Point): void {
  const [kind, route] = tool.split(":") as ["line" | "arrow", Route];
  const short = Math.hypot(to.x - from.x, to.y - from.y) < MIN_DRAW * 2;
  const end = short ? { x: from.x + 120, y: from.y } : to;
  const items = itemsOf(session);
  const reach = STICK / zoom;
  const a = nearestSite(items, session.scope, from, reach);
  const b = short ? null : nearestSite(items, session.scope, end, reach);
  const element = line(route, kind === "arrow", a ? a.point : from, b ? b.point : end);
  if (a || b) {
    // Attached to an element at either end, it is a connector: it follows the elements when they move.
    const connector = { ...element, type: "connector", route, ...(a ? { from: { el: a.id, side: a.side } } : {}), ...(b ? { to: { el: b.id, side: b.side } } : {}) } as Element;
    session.elements.insert([connector]);
  } else {
    session.elements.insert([element]);
  }
}
