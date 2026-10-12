// The smart guides, drawn straight into the page. A box passing a slide full of things lined up meets dozens of lines and gap
// marks and each step has a few come and go: made and taken away by React that was most of what a drag cost on a busy slide,
// and it said nothing the pointer had not. Here a guide is a node that stays while its line stays, and is moved with the
// browser's `translate` and `scale`, which need no layout; it fades when its line goes.

import type { Guide } from "@kasten-slides/canvas";

import { EASE, fastMs, motionOn, play } from "../motion.ts";

/** The most guides that fade in when the first come; with more they just appear. */
const MOST_FADING = 2;

/** The most alignment lines drawn at once, and the most gap marks: on a slide of aligned things a box meets dozens, and the eye can use a few. */
export const MOST_LINES = 12;
export const MOST_GAPS = 4;
/** How long a gap mark's ends are, in pixels. */
const TICK = 9;

/** The guides worth drawing: every alignment line up to a limit, and the gap marks nearest `near` (the middle of what is moved). */
export function limitGuides(guides: readonly Guide[], near: { x: number; y: number } | null): Guide[] {
  const lines = guides.filter((guide) => guide.kind !== "spacing");
  const gaps = guides.filter((guide) => guide.kind === "spacing");
  const from = (guide: Guide): number => {
    if (!near) return 0;
    const mid = (guide.from + guide.to) / 2;
    return guide.axis === "y" ? Math.hypot(mid - near.x, guide.at - near.y) : Math.hypot(guide.at - near.x, mid - near.y);
  };
  const closest = near ? [...gaps].sort((a, b) => from(a) - from(b)) : gaps;
  return [...lines.slice(0, MOST_LINES), ...closest.slice(0, MOST_GAPS)];
}

/** Guides by what makes them the same line from one step to the next, so that a line that stays is not drawn afresh, and one that goes can fade. */
export function keyedGuides(guides: readonly Guide[]): Map<string, Guide> {
  const keyed = new Map<string, Guide>();
  for (const guide of guides) {
    // A spacing mark is no line at one place: a row of them shares a height, so they are told apart by where they start.
    const base = guide.kind === "spacing" ? `${guide.axis}:${guide.kind}:${Math.round(guide.at)}:${Math.round(guide.from / 8)}` : `${guide.axis}:${guide.kind}:${guide.at}`;
    let key = base;
    for (let n = 2; keyed.has(key); n += 1) key = `${base}#${n}`;
    keyed.set(key, guide);
  }
  return keyed;
}

/** Where a node goes: from the top left of the slide, and how it is stretched, as the `translate` and `scale` properties say it. */
interface Put {
  translate: string;
  scale: string;
}

/** A line is a node of one pixel, stretched along its length: nothing about it needs layout. At whole pixels, so it is crisp. */
function lineAt(guide: Guide, zoom: number): Put {
  const length = Math.max((guide.to - guide.from) * zoom, 0);
  return guide.axis === "x"
    ? { translate: `${Math.round(guide.at * zoom)}px ${guide.from * zoom}px`, scale: `1 ${length}` }
    : { translate: `${guide.from * zoom}px ${Math.round(guide.at * zoom)}px`, scale: `${length} 1` };
}

/** The ends of a gap mark, and the middle where its size is said. */
function endsOf(guide: Guide, zoom: number): { first: string; second: string; middle: string } {
  // The tick is centred on the pixel the line is drawn in.
  const half = (TICK - 1) / 2;
  if (guide.axis === "y") {
    const y = Math.round(guide.at * zoom) - half;
    return { first: `${guide.from * zoom}px ${y}px`, second: `${guide.to * zoom}px ${y}px`, middle: `${((guide.from + guide.to) / 2) * zoom}px ${guide.at * zoom}px` };
  }
  const x = Math.round(guide.at * zoom) - half;
  return { first: `${x}px ${guide.from * zoom}px`, second: `${x}px ${guide.to * zoom}px`, middle: `${guide.at * zoom}px ${((guide.from + guide.to) / 2) * zoom}px` };
}

interface Mark {
  /** The node that holds the parts of the guide, and fades with them. */
  set: HTMLElement;
  line: HTMLElement;
  ends: HTMLElement[];
  label: HTMLElement | null;
  /** What was last written, so that a step that changes nothing writes nothing. */
  written: string;
}

/**
 * The guides of one page, kept in `host`, which holds nothing else. Making and taking away nodes costs the page a style
 * resolution each, and writing `opacity` a layout, more than a step of a drag can spare when a few guides come and go every
 * step: so a node, once made, stays, and is shown or put away in a pool for the next guide by `visibility` alone. A guide fades
 * in and out with the browser's own animation, and only when few come or go at once.
 */
export class GuideBoard {
  private readonly marks = new Map<string, Mark>();
  private readonly pool: { lines: Mark[]; gaps: Mark[] } = { lines: [], gaps: [] };

  constructor(private readonly host: HTMLElement) {}

  private make(gap: boolean): Mark {
    const doc = this.host.ownerDocument;
    const set = doc.createElement("div");
    set.className = "ks-guide-set";
    const line = doc.createElement("div");
    set.append(line);
    const mark: Mark = { set, line, ends: [], label: null, written: "" };
    if (gap) {
      for (let i = 0; i < 2; i += 1) {
        const end = doc.createElement("div");
        end.className = "ks-guide-tick";
        set.append(end);
        mark.ends.push(end);
      }
      mark.label = doc.createElement("span");
      mark.label.className = "ks-guide-label";
      set.append(mark.label);
    }
    this.host.append(set);
    return mark;
  }

  /** A node for a guide: one from the pool, or a new one, set up to say what this guide is, fading in when it is one of few. */
  private take(guide: Guide, fade: boolean): Mark {
    const gap = guide.kind === "spacing";
    const mark = (gap ? this.pool.gaps : this.pool.lines).pop() ?? this.make(gap);
    const className = `ks-guide is-${guide.kind}`;
    if (mark.line.className !== className) mark.line.className = className;
    if (mark.line.dataset.axis !== guide.axis) mark.line.dataset.axis = guide.axis;
    for (const end of mark.ends) if (end.dataset.axis !== guide.axis) end.dataset.axis = guide.axis;
    mark.written = "";
    mark.set.style.visibility = "visible";
    if (fade) play(mark.set, [{ opacity: 0 }, { opacity: 1 }], { duration: fastMs(mark.set), easing: EASE });
    return mark;
  }

  /** Puts a node away: hidden, to be used again. */
  private park(mark: Mark): void {
    mark.set.style.visibility = "hidden";
    (mark.label ? this.pool.gaps : this.pool.lines).push(mark);
  }

  /** A guide that is no longer wanted fades, if it is one of few, then is put away. */
  private release(mark: Mark, fade: boolean): void {
    const fading = fade ? play(mark.set, [{ opacity: 1 }, { opacity: 0 }], { duration: fastMs(mark.set), easing: EASE, fill: "forwards" }) : null;
    if (!fading) return this.park(mark);
    const done = () => {
      fading.cancel();
      this.park(mark);
    };
    void fading.finished.then(done, done);
  }

  /** Draws exactly these guides: lines that stay stay, new ones appear, the rest fade. */
  show(guides: readonly Guide[], zoom: number): void {
    const now = keyedGuides(guides);
    const going = [...this.marks].filter(([key]) => !now.has(key));
    // Guides fade where the eye can follow it: the first ones to come after none, and all of them going at the end. A box that
    // passes a crowd of things has guides come and go every step, and a fade on each would cost more than the drag; they just
    // come and go (an opacity written or animated makes the page work again, a `visibility` does not).
    const ending = now.size === 0 && going.length <= MOST_LINES + MOST_GAPS;
    const starting = this.marks.size === 0 && now.size <= MOST_FADING;
    for (const [key, mark] of going) {
      this.marks.delete(key);
      this.release(mark, motionOn() && ending);
    }
    for (const [key, guide] of now) {
      let mark = this.marks.get(key);
      if (!mark) {
        mark = this.take(guide, motionOn() && starting);
        this.marks.set(key, mark);
      }
      const at = lineAt(guide, zoom);
      const spot = guide.kind === "spacing" ? endsOf(guide, zoom) : null;
      const written = `${at.translate}|${at.scale}|${spot ? `${spot.first}|${spot.second}|${spot.middle}` : ""}`;
      if (written === mark.written) continue;
      mark.written = written;
      mark.line.style.translate = at.translate;
      mark.line.style.scale = at.scale;
      if (spot && mark.label) {
        mark.ends[0]!.style.translate = spot.first;
        mark.ends[1]!.style.translate = spot.second;
        mark.label.style.translate = spot.middle;
        const gap = String(Math.round(guide.to - guide.from));
        if (mark.label.textContent !== gap) mark.label.textContent = gap;
      }
    }
  }

  /** Takes every guide away, fading the few there are. */
  clear(zoom: number): void {
    this.show([], zoom);
  }

  /** Takes every guide away at once: the page is going. */
  dispose(): void {
    this.marks.clear();
    this.pool.lines.length = 0;
    this.pool.gaps.length = 0;
    for (const node of this.host.querySelectorAll(".ks-guide-set")) node.remove();
  }
}
