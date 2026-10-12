// Putting a gallery image on the shown slide: in the largest free place (a
// double click), where it was dropped, or into an empty image slot of the
// layout, cropped to fill it. Placing is one engine operation, so one step of
// undo; a picture that comes from a paper then cites it, which is a second step
// (see `citeImage`).

import type { Crop } from "@kasten-slides/wasm";

import { citeImage } from "../citations/cite-image.ts";
import { image as imageElement } from "../factory.ts";
import type { HostImage } from "../host.ts";
import { boxFor, masterBoxes, occupiedBy } from "../placement.ts";
import type { EditorSession } from "../session/session.ts";
import type { Box } from "../session/types.ts";

/** What is assumed of a picture whose size nobody knows and that cannot be loaded. */
export const FALLBACK_SIZE = { w: 640, h: 400 };

/** How long a picture is given to load when its size has to be measured. */
const MEASURE_MS = 4000;

/** The size of a picture by loading it; null when it cannot be told. */
export function measure(url: string): Promise<{ w: number; h: number } | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const picture = new Image();
    const done = (size: { w: number; h: number } | null) => {
      window.clearTimeout(timer);
      picture.onload = picture.onerror = null;
      resolve(size);
    };
    const timer = window.setTimeout(() => done(null), MEASURE_MS);
    picture.onload = () => done(picture.naturalWidth >= 1 && picture.naturalHeight >= 1 ? { w: picture.naturalWidth, h: picture.naturalHeight } : null);
    picture.onerror = () => done(null);
    picture.src = url;
  });
}

/** How many pixels wide and high the picture is: the host's account, else by loading it. */
export async function naturalSize(session: EditorSession, image: HostImage): Promise<{ w: number; h: number }> {
  if (image.width && image.height) return { w: image.width, h: image.height };
  const url = session.host.imageUrl(image.path);
  return (url ? await measure(url) : null) ?? FALLBACK_SIZE;
}

/** The alt text a placed picture starts with: its caption's first line, else its name without the extension. */
export function altOf(image: HostImage): string {
  const caption = image.caption?.split("\n")[0]?.trim();
  if (caption) return caption.length > 140 ? `${caption.slice(0, 139)}…` : caption;
  return image.name.replace(/\.[^.]+$/, "");
}

/** The least a small picture is shown at, on its longer side, in slide units: a 4-pixel picture is a dot otherwise. */
const LEAST_SIDE = 96;

/** The box a picture of `natural` size starts at on a slide of `slide` units: at most `share` of it, and not too small to see. */
export function preferredBox(natural: { w: number; h: number }, slide: { w: number; h: number }, share = 0.6): Box {
  const scale = Math.min((slide.w * share) / natural.w, (slide.h * share) / natural.h, 1);
  const grow = Math.max(scale, LEAST_SIDE / Math.max(natural.w, natural.h));
  const w = Math.max(1, Math.round(natural.w * grow));
  const h = Math.max(1, Math.round(natural.h * grow));
  return { x: Math.round((slide.w - w) / 2), y: Math.round((slide.h - h) / 2), w, h };
}

const crosses = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Where a picture that prefers `size` goes on the shown slide: the middle of the largest place nothing is in. If that
 * place would not take it at a fair size it goes there smaller, rather than over the title; only when nothing is
 * free at any size is it put over the middle of the slide.
 */
export function spotFor(session: EditorSession, size: { w: number; h: number }): Box {
  const { deck } = session;
  const { layout, elements } = session.slide;
  const obstacles = [...occupiedBy(deck.theme, layout, elements, deck.size), ...masterBoxes(deck.theme, layout, deck.size)];
  const first = boxFor(size, obstacles, deck.size);
  let box = first;
  for (const share of [0.75, 0.55, 0.4, 0.28]) {
    if (!obstacles.some((o) => crosses(box, o))) return box;
    box = boxFor({ w: Math.max(8, Math.round(size.w * share)), h: Math.max(8, Math.round(size.h * share)) }, obstacles, deck.size);
  }
  return obstacles.some((o) => crosses(box, o)) ? first : box;
}

/** Adds the picture to the shown slide in the largest free place, at a size that suits the slide. Resolves to the new element's id. */
export async function insertInFreeArea(session: EditorSession, image: HostImage): Promise<string | undefined> {
  const preferred = preferredBox(await naturalSize(session, image), session.deck.size);
  const box = spotFor(session, { w: preferred.w, h: preferred.h });
  const id = session.elements.insert([imageElement(image.path, box, altOf(image))])[0];
  if (id) citeImage(session, image);
  return id;
}

/** Adds the picture to the shown slide with its middle at `at` (a drop), kept on the slide. */
export async function insertAt(session: EditorSession, image: HostImage, at: { x: number; y: number }): Promise<string | undefined> {
  const slide = session.deck.size;
  const box = preferredBox(await naturalSize(session, image), slide, 0.5);
  const x = Math.min(Math.max(Math.round(at.x - box.w / 2), 0), Math.max(slide.w - box.w, 0));
  const y = Math.min(Math.max(Math.round(at.y - box.h / 2), 0), Math.max(slide.h - box.h, 0));
  const id = session.elements.insert([imageElement(image.path, { ...box, x, y }, altOf(image))])[0];
  if (id) citeImage(session, image);
  return id;
}

/** What to cut from a picture of `natural` size so that it fills a box of `frame`'s shape, centred; null when it already has that shape. */
export function coverCrop(natural: { w: number; h: number }, frame: { w: number; h: number }): Crop | null {
  if (!(natural.w > 0 && natural.h > 0 && frame.w > 0 && frame.h > 0)) return null;
  const picture = natural.w / natural.h;
  const slot = frame.w / frame.h;
  if (!Number.isFinite(picture) || !Number.isFinite(slot) || Math.abs(picture - slot) / slot < 0.005) return null;
  // The part of the picture that shows: the whole of one side, and as much of the other as the slot's shape asks for.
  const cut = picture > slot ? { x: (1 - slot / picture) / 2, y: 0 } : { x: 0, y: (1 - picture / slot) / 2 };
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return { left: round(cut.x), right: round(cut.x), top: round(cut.y), bottom: round(cut.y) };
}

/** Puts the picture into the empty image slot `id` (its box `frame` stays, the picture is cropped to fill it), and cites its paper. */
export async function fillSlot(session: EditorSession, id: string, frame: Box, image: HostImage): Promise<void> {
  const crop = coverCrop(await naturalSize(session, image), frame);
  session.elements.patch({ src: image.path, alt: altOf(image), crop }, [id]);
  // Only a slot that took the picture cites its paper: the engine may have refused (and said so).
  const filled = session.slide.elements.find((e) => e.id === id);
  if (filled?.type === "image" && filled.src === image.path) citeImage(session, image);
}
