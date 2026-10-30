// An agent asked for a diagram as a PNG (to keep as a LaTeX figure or in the
// vault's assets). Only a window has a canvas, so the app hands the window the
// picture's SVG, already cleaned (nothing in it runs or fetches), and this
// draws it on an off-screen canvas and answers with the PNG as text. Nothing is
// fetched and nothing is shown; the app checks what comes back before anyone
// uses it. Too big a file is drawn again smaller rather than refused.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { inTauri } from "../../lib/api";

/** The event the app asks for a picture with. */
export const DRAW_EVENT = "kasten://draw-png";

/** What the app asks the window to draw. */
export interface DrawJob {
  id: string;
  svg: string;
  /** A CSS colour, or "transparent". */
  background: string;
  scale: number;
  maxSide: number;
  maxBytes: number;
}

type Draw = (svg: string, scale: number, maxSide: number, background: string) => Promise<Uint8Array>;

/** How much smaller each try is drawn when the file came out too big, and how many tries. */
const SHRINK = 0.7;
const TRIES = 5;

/** The bytes as base64 text, in pieces so a big picture does not overflow the stack. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** The PNG of the job's picture, drawn smaller each time until it fits. Throws why when it cannot. */
export async function drawWithin(job: DrawJob, draw: Draw): Promise<Uint8Array> {
  let scale = job.scale;
  for (let tries = 0; tries < TRIES; tries++) {
    const bytes = await draw(job.svg, scale, job.maxSide, job.background);
    if (bytes.length <= job.maxBytes) return bytes;
    scale *= SHRINK;
  }
  throw new Error("The picture is too big to send, even drawn smaller");
}

/** The default way to draw: the window's own canvas (loaded when the first picture is asked for). */
const canvas: Draw = async (svg, scale, maxSide, background) => (await import("./picture")).pngOfSvg(svg, scale, maxSide, background);

/** Draws one job and tells the app what came of it. Never throws: the app is told why instead. */
export async function answerJob(job: DrawJob, draw: Draw = canvas): Promise<void> {
  try {
    const bytes = await drawWithin(job, draw);
    await invoke("diagram_png_answer", { id: job.id, png: base64Of(bytes) });
  } catch (err) {
    const why = err instanceof Error ? err.message : "This window could not draw the picture";
    await invoke("diagram_png_answer", { id: job.id, error: why }).catch(() => {});
  }
}

/** Answers the app's requests for a picture, for as long as the window is there. */
export function useDrawForAgents(): void {
  useEffect(() => {
    if (!inTauri()) return;
    let gone = false;
    let stop: (() => void) | undefined;
    void listen<DrawJob>(DRAW_EVENT, (event) => void answerJob(event.payload)).then((unlisten) => (gone ? unlisten() : (stop = unlisten)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
}
