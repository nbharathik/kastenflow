// A diagram's picture taken out as a file or an image from where it is only
// shown (a page, a card, a tile). The SVG kept beside the source is exported as
// it is; a PNG is drawn by the editor when it is installed (see `diagramPng`).

import type { VaultClient } from "../../lib/vault/types";
import { useDiagramEditor } from "./editor";
import { useDiagramHost } from "./host-store";
import { stemOfPath } from "./names";

/** The picture as an SVG file in the person's downloads. */
export async function exportSvg(client: VaultClient, path: string): Promise<string> {
  const svg = await client.diagramPreview(path);
  if (!svg) throw new Error("This diagram has no picture yet; open it in the editor first");
  return client.saveDownload(`${stemOfPath(path)}.svg`, new TextEncoder().encode(svg), "image/svg+xml");
}

/** The picture drawn as a PNG at `scale` times its size, on white (or `background`, a colour, or "transparent"); with `maxSide`, no side is longer than that many pixels (a big diagram is drawn smaller rather than as a huge file). Throws why when this window cannot. */
export async function pngOfSvg(svg: string, scale = 2, maxSide = Infinity, background = "#ffffff"): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const natural = { w: image.naturalWidth || 800, h: image.naturalHeight || 600 };
    const used = Math.min(scale, maxSide / Math.max(natural.w, natural.h));
    const width = Math.max(1, Math.round(natural.w * used));
    const height = Math.max(1, Math.round(natural.h * used));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This window cannot draw a PNG");
    if (background !== "transparent") {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("This window cannot draw a PNG; open the diagram and export it from the editor");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The size in pixels an SVG says it has, when it says (the editor's pictures do). */
export function sizeOfSvg(svg: string): { w: number; h: number } | null {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const number = (name: string) => Number(new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`).exec(root)?.[1]);
  const [w, h] = [number("width"), number("height")];
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * A PNG of the diagram at `path`, `scale` times its size (and not past `maxSide` pixels on its longer side).
 * The editor draws it, off screen, from the source: a window will not draw the picture saved beside the source into a
 * canvas once the editor has written its labels into it (Chromium and WebKit both refuse, calling the canvas tainted).
 * Without the editor the saved picture is tried, which works for a picture with no such labels.
 */
export async function diagramPng(client: VaultClient, path: string, options: { scale?: number; maxSide?: number } = {}): Promise<Uint8Array> {
  const scale = options.scale ?? 2;
  const svg = await client.diagramPreview(path).catch(() => null);
  const size = svg ? sizeOfSvg(svg) : null;
  const wanted = size && options.maxSide ? Math.min(scale, options.maxSide / Math.max(size.w, size.h)) : scale;
  if (useDiagramEditor.getState().info?.installed) return useDiagramHost.getState().renderPng(path, wanted);
  if (!svg) throw new Error("This diagram has no picture yet. Install the diagram editor to draw it");
  try {
    return await pngOfSvg(svg, scale, options.maxSide);
  } catch (err) {
    throw new Error("This window cannot draw a PNG of this diagram without the diagram editor. Install the editor, or export the SVG", { cause: err });
  }
}

/** The picture as a PNG file in the person's downloads. */
export async function exportPngFile(client: VaultClient, path: string): Promise<string> {
  return client.saveDownload(`${stemOfPath(path)}.png`, await diagramPng(client, path), "image/png");
}

/** The picture on the clipboard as an image, to paste where one goes. */
export async function copyPicture(client: VaultClient, path: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("This window cannot copy an image");
  const bytes = await diagramPng(client, path);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes as BlobPart], { type: "image/png" }) })]);
}
