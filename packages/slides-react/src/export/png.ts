// Slides as PNG pictures: each is the slide drawn by the same renderer the editor
// uses, as static markup, turned into pixels by the browser (see raster.ts). The
// fonts and pictures the markup needs go into the SVG that holds it as data, since
// an SVG that is drawn as an image loads nothing from outside.

import type { Deck } from "@kasten-slides/wasm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SlideView } from "../render/index.ts";
// Formulas are drawn as the markup is made, so KaTeX is loaded with this file.
import "../render/math.ts";
import { katexStyles } from "./katex-css.ts";
import { type PrintPage, pagesOf } from "./print.tsx";
import { rasterize } from "./raster.ts";
import { slideStyles } from "./slide-css.ts";

export type PngScale = 1 | 2 | 4;

export interface PngOptions {
  /** `current`: the slide being edited, even if it is hidden. `all`: every slide that is shown. */
  scope: "current" | "all";
  /** Pixels to each unit of the slide: a slide of 960 x 540 units comes out at 960, 1920 or 3840 pixels wide. */
  scale: PngScale;
  /** As for printing: each slide once as it ends, or a picture for every step of a slide that has steps. */
  steps: "final" | "each";
}

export const DEFAULT_PNG: PngOptions = { scope: "all", scale: 2, steps: "final" };

/** The pages a PNG export draws. */
export function pngPages(deck: Deck, options: PngOptions, current?: string): PrintPage[] {
  if (options.scope === "all") return pagesOf(deck, { steps: options.steps, notes: false });
  const slide = deck.slides.find((s) => s.id === current) ?? deck.slides[0];
  if (!slide) return [];
  // A hidden slide is counted when it is the one asked for, so its number is where it stands.
  const number = deck.slides.filter((s) => !s.hidden || s === slide).indexOf(slide) + 1;
  const steps = slide.steps ?? 0;
  if (steps > 0 && options.steps === "each") return Array.from({ length: steps + 1 }, (_, step) => ({ slide, step, number }));
  return [{ slide, step: steps > 0 ? steps : undefined, number }];
}

/** The name of a page's file inside an archive: `slide-03.png`, or `slide-03-step-2.png` when the steps are told apart. */
export function entryName(page: PrintPage, count: number, withStep: boolean): string {
  const width = Math.max(2, String(count).length);
  const step = withStep && page.step !== undefined ? `-step-${page.step}` : "";
  return `slide-${String(page.number).padStart(width, "0")}${step}.png`;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" };

/** The kind of picture these bytes are, from their first bytes. */
function sniff(bytes: Uint8Array): string | undefined {
  const at = (offset: number, ...values: number[]): boolean => values.every((value, i) => bytes[offset + i] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  const start = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return start.startsWith("<svg") || start.startsWith("<?xml") ? "image/svg+xml" : undefined;
}

/** A picture as a `data:` URL: the kind from its file name, or from its bytes when the name does not say. */
export function dataUrlOf(path: string, bytes: Uint8Array): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  const type = MIME[extension] ?? sniff(bytes) ?? "application/octet-stream";
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/** What makes the pictures; a test gives its own to stand in for the browser. */
export interface PngTools {
  /** The pictures the deck names, by the path the deck uses. */
  images?: ReadonlyMap<string, Uint8Array>;
  /** The id of the slide being edited. */
  current?: string;
  raster?: typeof rasterize;
  styles?: typeof slideStyles;
  katex?: typeof katexStyles;
  progress?: (done: number, total: number) => void;
}

export interface SlidePicture {
  name: string;
  bytes: Uint8Array;
  /** The slide's place among those shown, from 1. */
  number: number;
}

export interface PngResult {
  pictures: SlidePicture[];
  /** What is not as it should be, in words for a person: a page left out, a font that stood in for another. */
  warnings: string[];
}

/**
 * The pictures of the pages asked for, one after the other. A page the browser
 * cannot draw is left out and told of; when it can draw none, that is an error.
 */
export async function slidePictures(deck: Deck, options: PngOptions, tools: PngTools = {}): Promise<PngResult> {
  const { images = new Map<string, Uint8Array>(), current, raster = rasterize, styles = slideStyles, katex = katexStyles, progress } = tools;
  const pages = pngPages(deck, options, current);
  const shown = deck.slides.filter((slide) => !slide.hidden).length;
  const urls = new Map([...images].map(([path, bytes]) => [path, dataUrlOf(path, bytes)]));
  const imageUrl = (src: string): string | undefined => urls.get(src);
  const withStep = options.steps === "each";
  const pictures: SlidePicture[] = [];
  const warnings: string[] = [];
  const toldOf = new Set<string>();
  let done = 0;
  for (const page of pages) {
    const html = renderToStaticMarkup(createElement(SlideView, { deck, slide: page.slide, number: page.number, count: shown, step: page.step, mode: "export", imageUrl }));
    const { css, missing } = await styles(html);
    for (const font of missing) {
      if (toldOf.has(font)) continue;
      toldOf.add(font);
      warnings.push(`The font ${font} could not be put in the pictures, so another font stands in for it.`);
    }
    const formulas = html.includes('class="katex') ? await katex(html) : null;
    const bytes = await raster(html, formulas ? `${css}\n${formulas}` : css, deck.size.w, deck.size.h, options.scale);
    if (bytes) pictures.push({ name: entryName(page, deck.slides.length, withStep), bytes, number: page.number });
    else warnings.push(`The picture of slide ${page.number}${page.step !== undefined && withStep ? ` (step ${page.step})` : ""} could not be drawn.`);
    progress?.(++done, pages.length);
  }
  if (pages.length > 0 && pictures.length === 0) throw new Error("This browser cannot draw slides into pictures. Save as PDF from the print dialog instead.");
  return { pictures, warnings };
}
