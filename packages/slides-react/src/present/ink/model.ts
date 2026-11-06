// What is drawn on a slide during a show, and the messages that carry it between the audience's window and the presenter's. A point is
// where the pen was on the slide, as a fraction of its width and of its height, so the same stroke lands on the same place in two
// windows of any size. Ink belongs to the show: it is never written into the deck.

export type InkTool = "pen" | "highlighter";

/** The colours of the ink, by name; `ink.css` gives each its colour. */
export const INK_COLORS = ["red", "blue", "green", "yellow", "white", "black"] as const;
export type InkColor = (typeof INK_COLORS)[number];

/** How thick each tool draws, as a fraction of the slide's width. */
export const INK_WIDTH: Record<InkTool, number> = { pen: 0.0045, highlighter: 0.026 };

export interface Stroke {
  id: string;
  tool: InkTool;
  color: InkColor;
  /** Fraction of the slide's width. */
  width: number;
  /** x0, y0, x1, y1, … each from 0 to 1 over the slide. */
  points: number[];
}

/** The most numbers one stroke may hold, and strokes one slide may keep; a message from a window is not trusted to be small. */
export const MOST_POINTS = 6000;
export const MOST_STROKES = 400;

/** What one window tells the other about the ink. */
export type InkEvent =
  /** A stroke is finished. */
  | { op: "add"; slide: string; stroke: Stroke }
  /** A stroke is being drawn: the other window shows it as it grows. */
  | { op: "live"; slide: string; stroke: Stroke }
  /** The last stroke of the slide is taken back. */
  | { op: "undo"; slide: string }
  | { op: "clear"; slide: string }
  /** "Keep ink" was turned on or off. */
  | { op: "keep"; keep: boolean };

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= 200;

export function readStroke(value: unknown): Stroke | null {
  if (typeof value !== "object" || value === null) return null;
  const stroke = value as Record<string, unknown>;
  const { id, tool, color, width, points } = stroke;
  if (!isText(id) || (tool !== "pen" && tool !== "highlighter") || !INK_COLORS.includes(color as InkColor)) return null;
  if (!isNumber(width) || width <= 0 || width > 0.1) return null;
  if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0 || points.length > MOST_POINTS || !points.every(isNumber)) return null;
  return { id, tool, color: color as InkColor, width, points: points.map((n) => Math.min(Math.max(n, -0.5), 1.5)) };
}

export function readInk(value: unknown): InkEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Record<string, unknown>;
  if (event.op === "keep") return typeof event.keep === "boolean" ? { op: "keep", keep: event.keep } : null;
  if (!isText(event.slide)) return null;
  switch (event.op) {
    case "undo":
    case "clear":
      return { op: event.op, slide: event.slide };
    case "add":
    case "live": {
      const stroke = readStroke(event.stroke);
      return stroke ? { op: event.op, slide: event.slide, stroke } : null;
    }
    default:
      return null;
  }
}

/** The laser pointer of the other window: where it is on the slide (fractions, as the ink's), or null when it is off. */
export interface LaserAt {
  slide: string;
  x: number;
  y: number;
}

/** The laser a message names; null when it says the laser is off; undefined when it is not a laser at all. */
export function readPointer(value: unknown): LaserAt | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const at = value as Record<string, unknown>;
  return isText(at.slide) && isNumber(at.x) && isNumber(at.y) ? { slide: at.slide, x: Math.min(Math.max(at.x, 0), 1), y: Math.min(Math.max(at.y, 0), 1) } : undefined;
}
