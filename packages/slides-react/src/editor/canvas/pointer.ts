// Where the pointer is over the slide, for the keys that put something at it
// (T, R and O). The canvas notes each move as a plain write, with no state and
// no drawing, so following the pointer costs nothing; the place on the slide is
// worked out only when a key asks, from where the page is by then (it may have
// been scrolled or zoomed under a pointer that has not moved).

import type { Point } from "@kasten-slides/canvas";

import type { EditorUi } from "../ui-state.ts";

/** How a place in the window is a place on the slide, in slide units; null when it is not on the slide. */
export type ToSlide = (clientX: number, clientY: number) => Point | null;

export class PointerTrack {
  private x = 0;
  private y = 0;
  private over = false;
  /** Whether the pointer has been over the slide at all. */
  private seen = false;
  private toSlide: ToSlide | null = null;

  /** The pointer moved over the slide's surface: its handles and the text box being edited count as the slide. */
  moved(clientX: number, clientY: number): void {
    this.x = clientX;
    this.y = clientY;
    this.over = true;
    this.seen = true;
  }

  /** The pointer left the surface. */
  left(): void {
    this.over = false;
  }

  /** The canvas says how to read a place in the window as a place on the slide. Returns how to take that back. */
  attach(toSlide: ToSlide): () => void {
    this.toSlide = toSlide;
    return () => {
      if (this.toSlide === toSlide) this.toSlide = null;
    };
  }

  /** Where the pointer is on the slide, in slide units; null when it is somewhere else, or when no slide is shown. */
  slidePoint(): Point | null {
    return this.over && this.toSlide ? this.toSlide(this.x, this.y) : null;
  }

  /**
   * Where the pointer last was on the slide, in slide units, though it has gone off it since (to a menu, the filmstrip): the spot a command
   * given from there puts something at. Null when it has not been over the slide, or that place is no longer on it.
   */
  lastSlidePoint(): Point | null {
    return this.seen && this.toSlide ? this.toSlide(this.x, this.y) : null;
  }
}

const tracks = new WeakMap<EditorUi, PointerTrack>();

/** The pointer track of an editor window: the canvas writes to it and the commands read it. */
export function pointerOf(ui: EditorUi): PointerTrack {
  let track = tracks.get(ui);
  if (!track) {
    track = new PointerTrack();
    tracks.set(ui, track);
  }
  return track;
}
