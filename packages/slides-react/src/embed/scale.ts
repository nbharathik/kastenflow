// How a page is laid out in the box of an embed. A web page is designed for a window, not for a box of 640 by 360:
// laid out at the box's own size it is squeezed into its phone layout, or stretched. So it is laid out at a design size
// (a virtual window: Desktop 1280 by 800, say) and the whole is scaled to the box with a transform. The page keeps its
// own layout, fonts and proportions; resizing the box only changes the scale.
//
// Everything here is plain numbers: the frame, the zoom steps and the boxes a design gives. The views draw from it.

/** The size of the window a page is laid out for, in CSS pixels. */
export interface Design {
  w: number;
  h: number;
}

/**
 * How the page meets the box when no zoom is set:
 * - `width`: the page's width fills the box and the rest is scrolled to (the page is laid out as tall as the box needs);
 * - `page`: the whole design window is seen, with bars at the sides or the top where the box has another shape;
 * - `fill`: the design window covers the box, and what does not fit is cut off at the right and the bottom.
 */
export type Fit = "width" | "page" | "fill";

export const FITS: readonly Fit[] = ["width", "page", "fill"];

export interface DesignPreset extends Design {
  id: string;
  label: string;
}

/** The windows a page may be laid out for. A design that is none of these is Custom. */
export const DESIGNS: readonly DesignPreset[] = [
  { id: "desktop", label: "Desktop", w: 1280, h: 800 },
  { id: "wide", label: "Wide", w: 1440, h: 900 },
  { id: "slide", label: "Slide 16:9", w: 1280, h: 720 },
  { id: "tablet", label: "Tablet", w: 820, h: 1180 },
  { id: "phone", label: "Phone", w: 390, h: 844 },
  // What a page of the vault is laid out for: narrow, so that its words are big enough to read from a room.
  { id: "page", label: "Narrow page", w: 640, h: 360 },
];

export const DEFAULT_DESIGN: Design = { w: 1280, h: 800 };

/** A page of the host is laid out narrower, so that its words are big enough to read from a room. */
export const PAGE_DESIGN: Design = { w: 640, h: 360 };

export const DEFAULT_FIT: Fit = "width";

/** The smallest and biggest zoom a person may ask for (1 is 100%). */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

/** The sizes Ctrl plus and Ctrl minus step through, as a browser's own zoom does. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** The least a design may be, in CSS pixels: a page needs some width to be laid out at all. */
export const MIN_DESIGN = 200;
export const MAX_DESIGN = 4000;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A design from what a person typed or a file holds: within limits, whole pixels. */
export function sanitizeDesign(design: Partial<Design> | null | undefined, fallback: Design = DEFAULT_DESIGN): Design {
  const pick = (value: unknown, otherwise: number): number => (finite(value) ? Math.round(Math.min(Math.max(value, MIN_DESIGN), MAX_DESIGN)) : otherwise);
  return { w: pick(design?.w, fallback.w), h: pick(design?.h, fallback.h) };
}

/** The preset a design is, or null for a custom one. */
export function presetOf(design: Design): DesignPreset | null {
  return DESIGNS.find((preset) => preset.w === design.w && preset.h === design.h) ?? null;
}

/** What a design is called: its preset, else its size. */
export function designName(design: Design): string {
  const preset = presetOf(design);
  return preset ? preset.label : `Custom ${design.w}×${design.h}`;
}

/** A zoom within what is allowed (0.25 to 3); undefined for anything that is not a number. */
export function clampZoom(zoom: unknown): number | undefined {
  return finite(zoom) && zoom > 0 ? Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM) : undefined;
}

/** A zoom as a percentage, such as `62%`. */
export const percent = (scale: number): string => `${Math.round(scale * 100)}%`;

/** What an embed says about how its page is seen: all of it optional in a deck, all of it known here. */
export interface View {
  design: Design;
  /** `null` is Fit: the scale follows the box. A number is a fixed zoom, which a bigger box shows more of the page for. */
  zoom: number | null;
  fit: Fit;
}

/** The view an embed element holds, with a deck's blanks filled in. */
export function viewOf(element: { design?: Partial<Design> | null; zoom?: number | null; fit?: string | null }, fallback: Design = DEFAULT_DESIGN): View {
  const fit = FITS.find((f) => f === element.fit) ?? DEFAULT_FIT;
  return { design: sanitizeDesign(element.design, fallback), zoom: clampZoom(element.zoom) ?? null, fit };
}

/** Where a page is drawn in its box. */
export interface Frame {
  /** Slide units a CSS pixel of the page comes to: 1 draws the page at its own size. */
  scale: number;
  /** The size the page is laid out at, in CSS pixels: what the frame is told to be before it is scaled. */
  layout: { w: number; h: number };
  /** Where the page's top left is in the box, in slide units (not 0 for a letterboxed page). */
  at: { x: number; y: number };
  /** Whether the page is drawn smaller than the box has room for, with bars round it. */
  letterboxed: boolean;
}

const positive = (n: number): number => (finite(n) && n > 0 ? n : 1);

/** The scale of a page of `design` in a box of this size, for a fit. */
export function fitScale(box: { w: number; h: number }, design: Design, fit: Fit): number {
  const across = positive(box.w) / positive(design.w);
  const down = positive(box.h) / positive(design.h);
  return fit === "page" ? Math.min(across, down) : fit === "fill" ? Math.max(across, down) : across;
}

/**
 * How the page sits in the box. With a zoom the page is laid out as a window of the box's own size divided by the
 * zoom, as a browser does when it is zoomed: zoomed out, the page's layout sees a wider window. Without one, the
 * design says what window the page is laid out for and the fit says how it meets the box.
 */
export function frameFor(box: { w: number; h: number }, view: View): Frame {
  const w = positive(box.w);
  const h = positive(box.h);
  if (view.zoom !== null) {
    const scale = view.zoom;
    return { scale, layout: { w: w / scale, h: h / scale }, at: { x: 0, y: 0 }, letterboxed: false };
  }
  const scale = fitScale({ w, h }, view.design, view.fit);
  if (view.fit === "width") return { scale, layout: { w: view.design.w, h: h / scale }, at: { x: 0, y: 0 }, letterboxed: false };
  if (view.fit === "fill") return { scale, layout: { ...view.design }, at: { x: 0, y: 0 }, letterboxed: false };
  const shown = { w: view.design.w * scale, h: view.design.h * scale };
  return { scale, layout: { ...view.design }, at: { x: (w - shown.w) / 2, y: (h - shown.h) / 2 }, letterboxed: shown.w < w - 0.5 || shown.h < h - 0.5 };
}

/** The scale a view comes to in a box: its zoom, or the fit's. */
export const scaleOf = (box: { w: number; h: number }, view: View): number => frameFor(box, view).scale;

/**
 * The zoom one step bigger (`1`) or smaller (`-1`) than the one the page is at now, for Ctrl plus and Ctrl minus. A page
 * at Fit is at the scale the fit comes to, and steps from there. Null when the step would leave the range.
 */
export function stepZoom(box: { w: number; h: number }, view: View, direction: 1 | -1): number | null {
  const now = scaleOf(box, view);
  const next = direction > 0 ? ZOOM_STEPS.find((step) => step > now + 0.004) : [...ZOOM_STEPS].reverse().find((step) => step < now - 0.004);
  return next ?? null;
}

/** A box for a page of `design` that is `width` wide: it has the design's shape, so the page fills it at Fit without bars. */
export function boxFor(design: Design, width: number): { w: number; h: number } {
  const w = Math.max(width, 1);
  return { w, h: Math.round((w * design.h) / positive(design.w)) };
}

/** Whether a box has the shape of the design (within a pixel or two), so that a page fits it at Fit without bars or cutting. */
export function hasShapeOf(box: { w: number; h: number }, design: Design): boolean {
  return Math.abs(box.w / positive(box.h) - design.w / positive(design.h)) < 0.02;
}
