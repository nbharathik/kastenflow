// An eyedropper that reads the slide itself. Where the browser has no EyeDropper (WebKit on macOS and Linux), the slide on the stage is
// drawn into a picture by the same code that makes PNG files, the picture is read into pixels, and the person points at one.

import { rasterize } from "../../export/raster.ts";
import { slideStyles } from "../../export/slide-css.ts";

/** The pixels of a picture of the slide: what `ImageData` holds, without needing a canvas to make one. */
export interface Pixels {
  width: number;
  height: number;
  /** Red, green, blue, alpha of each pixel in turn, row by row. */
  data: ArrayLike<number>;
}

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** The colour of a pixel as `#rrggbb`; null outside the picture or where nothing is drawn (the picture is see-through there). */
export function hexAt(pixels: Pixels, x: number, y: number): string | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (!Number.isFinite(px + py) || px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return null;
  const at = (py * pixels.width + px) * 4;
  const [r, g, b, a] = [pixels.data[at], pixels.data[at + 1], pixels.data[at + 2], pixels.data[at + 3]];
  if (r === undefined || g === undefined || b === undefined || a === undefined || a === 0) return null;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Where a point of the screen falls on a picture shown in `box` (which may be scaled): in the picture's own pixels, or null outside it. */
export function pointOn(box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number, pixels: { width: number; height: number }): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const x = ((clientX - box.left) / box.width) * pixels.width;
  const y = ((clientY - box.top) / box.height) * pixels.height;
  return x >= 0 && y >= 0 && x < pixels.width && y < pixels.height ? { x, y } : null;
}

/** A step of the keyboard on the picture, in its pixels, kept inside it. */
export function nudged(at: { x: number; y: number }, key: string, big: boolean, pixels: { width: number; height: number }): { x: number; y: number } | null {
  const step = big ? 10 : 1;
  const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = by[key];
  if (!move) return null;
  return { x: Math.min(pixels.width - 1, Math.max(0, at.x + move[0])), y: Math.min(pixels.height - 1, Math.max(0, at.y + move[1])) };
}

/**
 * The slide on the stage as pixels, 1 to a unit of the slide. Null when there is no slide on the page or this browser cannot draw it
 * (the person is told by whoever asked). A picture the slide holds by a temporary address is left out of the picture.
 */
export async function sampleSlide(root: ParentNode = document): Promise<Pixels | null> {
  const slide = root.querySelector<HTMLElement>('.ks-slide[data-mode="edit"]') ?? root.querySelector<HTMLElement>(".ks-slide");
  if (!slide) return null;
  const width = Number.parseFloat(slide.style.width);
  const height = Number.parseFloat(slide.style.height);
  if (!(width > 0 && height > 0)) return null;
  try {
    const html = slide.outerHTML;
    const { css } = await slideStyles(html);
    const bytes = await rasterize(html, css, width, height, 1);
    if (!bytes) return null;
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  } catch {
    return null;
  }
}
