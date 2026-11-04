// The ink of one window of a show: the tool in hand, the colour, the strokes of the slide on the screen, and the other window's laser.
// Each window keeps its own store and tells the other what changes (`send`), so the two show the same ink without either being in charge.
// By default the ink goes when the slide changes; with "keep ink" each slide holds its ink for the rest of the show. Nothing here is saved.

import { type InkColor, type InkEvent, INK_WIDTH, type InkTool, type LaserAt, MOST_POINTS, MOST_STROKES, type Stroke } from "./model.ts";

export interface InkSnapshot {
  /** The tool in hand; null for none (the pointer clicks through to the show). */
  tool: InkTool | null;
  color: InkColor;
  keep: boolean;
  /** The slide the ink is for. */
  slide: string | null;
  /** The finished strokes of that slide. */
  strokes: readonly Stroke[];
  /** The stroke being drawn, here or in the other window. */
  live: Stroke | null;
  /** This window's laser is on. */
  laser: boolean;
  /** Where the other window's laser is on the slide; null when it is not. */
  remoteLaser: { x: number; y: number } | null;
}

/** How often a stroke that is being drawn is sent to the other window, at most. */
export const LIVE_MS = 40;

export interface InkLink {
  ink(event: InkEvent): void;
  laser(at: LaserAt | null): void;
}

export class InkStore {
  private readonly bySlide = new Map<string, Stroke[]>();
  private readonly listeners = new Set<() => void>();
  private current: InkSnapshot = { tool: null, color: "red", keep: false, slide: null, strokes: [], live: null, laser: false, remoteLaser: null };
  private drawing: Stroke | null = null;
  private sentAt = 0;
  private count = 0;
  private readonly prefix = Math.random().toString(36).slice(2, 7);

  constructor(
    private readonly link: Partial<InkLink> = {},
    private readonly now: () => number = Date.now,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): InkSnapshot => this.current;

  private change(part: Partial<InkSnapshot>): void {
    const slide = part.slide === undefined ? this.current.slide : part.slide;
    this.current = { ...this.current, strokes: slide ? (this.bySlide.get(slide) ?? []) : [], ...part };
    for (const listener of [...this.listeners]) listener();
  }

  /** The slide on the screen changed. The ink goes with it, unless it is being kept. */
  setSlide(slide: string | null): void {
    if (slide === this.current.slide) return;
    this.drawing = null;
    if (!this.current.keep) this.bySlide.clear();
    this.change({ slide, live: null, remoteLaser: null });
  }

  setTool(tool: InkTool | null): void {
    if (tool === this.current.tool) return;
    this.finish();
    // The laser and the pen are not in hand together.
    const wasLaser = this.current.laser;
    this.change({ tool, ...(tool ? { laser: false } : {}) });
    if (tool && wasLaser) this.link.laser?.(null);
  }

  toggleTool(tool: InkTool): void {
    this.setTool(this.current.tool === tool ? null : tool);
  }

  setColor(color: InkColor): void {
    if (color !== this.current.color) this.change({ color });
  }

  setKeep(keep: boolean, remote = false): void {
    if (keep === this.current.keep) return;
    this.change({ keep });
    if (!remote) this.link.ink?.({ op: "keep", keep });
  }

  private put(slide: string, stroke: Stroke): void {
    const strokes = [...(this.bySlide.get(slide) ?? []).filter((s) => s.id !== stroke.id), stroke].slice(-MOST_STROKES);
    this.bySlide.set(slide, strokes);
  }

  /** The pen goes down at a place on the slide (fractions of its width and height). */
  begin(x: number, y: number): void {
    const { tool, color, slide } = this.current;
    if (!tool || !slide) return;
    this.finish();
    this.drawing = { id: `${this.prefix}-${this.count++}`, tool, color, width: INK_WIDTH[tool], points: [x, y] };
    this.sentAt = 0;
    this.change({ live: this.drawing });
  }

  extend(x: number, y: number): void {
    const stroke = this.drawing;
    const slide = this.current.slide;
    if (!stroke || !slide || stroke.points.length >= MOST_POINTS) return;
    const grown = { ...stroke, points: [...stroke.points, x, y] };
    this.drawing = grown;
    this.change({ live: grown });
    const at = this.now();
    if (at - this.sentAt >= LIVE_MS) {
      this.sentAt = at;
      this.link.ink?.({ op: "live", slide, stroke: grown });
    }
  }

  /** The pen comes up: the stroke is kept (a touch with no movement is a dot) and the other window is given it whole. */
  finish(): void {
    const stroke = this.drawing;
    const slide = this.current.slide;
    this.drawing = null;
    if (!stroke || !slide) return;
    const done = stroke.points.length === 2 ? { ...stroke, points: [...stroke.points, ...stroke.points] } : stroke;
    this.put(slide, done);
    this.change({ live: null });
    this.link.ink?.({ op: "add", slide, stroke: done });
  }

  undo(): void {
    const slide = this.current.slide;
    if (!slide) return;
    const strokes = this.bySlide.get(slide) ?? [];
    if (strokes.length === 0) return;
    this.bySlide.set(slide, strokes.slice(0, -1));
    this.change({});
    this.link.ink?.({ op: "undo", slide });
  }

  clear(): void {
    const slide = this.current.slide;
    this.drawing = null;
    if (!slide) return;
    if ((this.bySlide.get(slide) ?? []).length === 0 && !this.current.live) return;
    this.bySlide.delete(slide);
    this.change({ live: null });
    this.link.ink?.({ op: "clear", slide });
  }

  /** The laser (the presenter's window): while it is on, `pointAt` tells the other window where it is. */
  setLaser(on: boolean): void {
    if (on === this.current.laser) return;
    this.change({ laser: on, ...(on ? { tool: null } : {}) });
    if (!on) this.link.laser?.(null);
  }

  pointAt(x: number, y: number): void {
    const slide = this.current.slide;
    if (this.current.laser && slide) this.link.laser?.({ slide, x, y });
  }

  /** What the other window did. */
  receive(event: InkEvent): void {
    if (event.op === "keep") return this.setKeep(event.keep, true);
    // Ink for a slide this window is not on is dropped, unless ink is being kept (then it waits for its slide).
    if (event.slide !== this.current.slide && !this.current.keep) return;
    if (event.op === "live") {
      if (event.slide === this.current.slide && !this.drawing) this.change({ live: event.stroke });
    } else if (event.op === "add") {
      this.put(event.slide, event.stroke);
      this.change({ ...(event.slide === this.current.slide ? { live: null } : {}) });
    } else if (event.op === "undo") {
      this.bySlide.set(event.slide, (this.bySlide.get(event.slide) ?? []).slice(0, -1));
      this.change({});
    } else {
      this.bySlide.delete(event.slide);
      this.change({ ...(event.slide === this.current.slide ? { live: null } : {}) });
    }
  }

  receiveLaser(at: LaserAt | null): void {
    const here = at !== null && at.slide === this.current.slide ? { x: at.x, y: at.y } : null;
    if (here === null && this.current.remoteLaser === null) return;
    this.change({ remoteLaser: here });
  }
}
