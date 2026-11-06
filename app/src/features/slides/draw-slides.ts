// An agent asked for slides as pictures (or for the size of a deck's words). The
// app hands this window the deck as text; the window draws it with the renderer
// the editor's own picture export uses and answers with the PNG as base64 text, or
// with JSON for the sizes of the words. Nothing is fetched but the vault's own
// pictures, and nothing is shown. The app checks what comes back before anyone uses
// it, so a window that cannot draw says why instead.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { inTauri } from "../../lib/api";
import { base64Of } from "../diagrams/draw-png";

/** The event the app asks for slides with. */
export const SLIDES_EVENT = "kasten://draw-slides";

/** What the app asks the window to draw. */
export interface SlidesJob {
  id: string;
  kind: "slide" | "grid" | "diff" | "measure";
  /** The deck to draw (for a comparison, the newer one), as the text of its file. */
  after: string;
  /** The older deck of a comparison. */
  before?: string | null;
  /** The slide, from 0 (in the newer deck). */
  slide?: number;
  /** The same slide in the older deck. */
  beforeSlide?: number;
  /** The click to draw at; none for the slide as it ends. */
  step?: number | null;
  /** Pixels to each unit of the slide. */
  scale: number;
  /** Boxes (x, y, w, h in slide units) to outline on each side of a comparison. */
  beforeMarks?: number[][];
  afterMarks?: number[][];
  maxSide: number;
  maxBytes: number;
}

/** What draws; a test gives its own. Each throws, saying why, when it cannot. */
export interface Shots {
  slide(deck: string, index: number, step: number | null, scale: number, maxSide: number): Promise<Uint8Array>;
  grid(deck: string, maxSide: number): Promise<Uint8Array>;
  diff(job: SlidesJob & { before: string }, scale: number): Promise<Uint8Array>;
  measure(deck: string): Promise<unknown>;
}

/** How much smaller each try is drawn when the file came out too big, and how many tries. */
const SHRINK = 0.7;
const TRIES = 5;

/** The picture, drawn smaller each time until it fits. Throws why when it cannot. */
export async function drawWithin(job: SlidesJob, draw: (scale: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  let scale = job.scale;
  for (let tries = 0; tries < TRIES; tries++) {
    const bytes = await draw(scale);
    if (bytes.length <= job.maxBytes) return bytes;
    scale *= SHRINK;
  }
  throw new Error("The picture is too big to send, even drawn smaller");
}

async function drawn(job: SlidesJob, shots: Shots): Promise<Uint8Array> {
  switch (job.kind) {
    case "slide":
      return drawWithin(job, (scale) => shots.slide(job.after, job.slide ?? 0, job.step ?? null, scale, job.maxSide));
    case "grid":
      return drawWithin(job, (scale) => shots.grid(job.after, Math.max(200, Math.round(job.maxSide * scale))));
    case "diff": {
      const before = job.before;
      if (!before) throw new Error("The older deck did not come with the request");
      return drawWithin(job, (scale) => shots.diff({ ...job, before }, scale));
    }
    default:
      throw new Error(`This window does not draw “${String(job.kind)}”`);
  }
}

/** The real drawing, loaded when the first job is asked for: it carries the slide renderer. */
const real: Shots = {
  slide: async (...args) => (await import("./slide-shots")).shots.slide(...args),
  grid: async (...args) => (await import("./slide-shots")).shots.grid(...args),
  diff: async (...args) => (await import("./slide-shots")).shots.diff(...args),
  measure: async (...args) => (await import("./slide-shots")).shots.measure(...args),
};

/** Answers one job and tells the app what came of it. Never throws: the app is told why instead. */
export async function answerSlidesJob(job: SlidesJob, shots: Shots = real): Promise<void> {
  try {
    if (job.kind === "measure") {
      await invoke("diagram_png_answer", { id: job.id, png: JSON.stringify(await shots.measure(job.after)) });
      return;
    }
    await invoke("diagram_png_answer", { id: job.id, png: base64Of(await drawn(job, shots)) });
  } catch (err) {
    const why = err instanceof Error ? err.message : "This window could not draw the slide";
    // If even telling fails the job times out on the app's side.
    await invoke("diagram_png_answer", { id: job.id, error: why }).catch(() => {});
  }
}

/** Answers the app's requests for slides, for as long as the window is there. */
export function useDrawSlidesForAgents(): void {
  useEffect(() => {
    if (!inTauri()) return;
    let gone = false;
    let stop: (() => void) | undefined;
    void listen<SlidesJob>(SLIDES_EVENT, (event) => void answerSlidesJob(event.payload)).then((unlisten) => (gone ? unlisten() : (stop = unlisten)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
}
