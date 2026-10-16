// Dragging the end of a line or a connector: where the end lands (on a side of a shape near it, else the pointer), the box the line is then
// drawn in, and what is written when the pointer is let go.

import type { Point } from "@kasten-slides/canvas";

import type { Placement } from "../session/elements.ts";
import type { EditorSession } from "../session/session.ts";
import { STICK, lineBox, snapAngle } from "./drawing.ts";
import { itemsOf, nearestSite } from "./geometry.ts";

/** The end of a line being dragged: which line and end, the other end (held still), and where the press was. */
export interface EndDrag {
  id: string;
  end: "start" | "end";
  fixed: Point;
  from: Point;
}

/** Where a dragged line end lands: on a side of a shape near it, else the pointer (in 45° steps with Shift). */
export function endPoint(session: EditorSession, zoom: number, g: EndDrag, at: Point, shift: boolean): Point {
  const site = nearestSite(itemsOf(session), session.scope, at, STICK / zoom, new Set([g.id]));
  if (site) return site.point;
  return shift ? snapAngle(g.fixed, at) : at;
}

/** The box the line is drawn in while its end is at `point`. */
export function endPreview(g: EndDrag, point: Point): Map<string, Placement> {
  const a = g.end === "start" ? point : g.fixed;
  const b = g.end === "start" ? g.fixed : point;
  return new Map([[g.id, lineBox(a, b)]]);
}

/** The pointer is let go with the end at `point`: the line takes its box, and a connector is joined to the side it ended on (or let go of). */
export function finishEnd(session: EditorSession, zoom: number, g: EndDrag, point: Point): void {
  const moved = Math.hypot(point.x - g.from.x, point.y - g.from.y) > 1;
  if (!moved) return;
  session.elements.place(endPreview(g, point));
  const site = nearestSite(itemsOf(session), session.scope, point, STICK / zoom, new Set([g.id]));
  const element = session.scope.find((e) => e.id === g.id);
  if (element?.type === "connector") {
    const key = g.end === "start" ? "from" : "to";
    session.elements.patch({ [key]: site ? { el: site.id, side: site.side } : null }, [g.id]);
  }
}
