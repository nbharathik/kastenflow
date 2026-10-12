// The deck as one web page that shows it offline: the slides drawn as they are in the app, on reveal.js with the same runtime
// (steps that come in, morphs, backup slides, the overview, the laser, the black screen), and the deck as one page that scrolls with
// its notes under `?view=scroll`. Nothing is fetched: reveal.js, the styles, the fonts and the pictures are all in the file.

import type { Deck, ExportWarning } from "@kasten-slides/wasm";
import { createElement } from "react";

import type { DeliveredFile, SlidesHost } from "../editor/host.ts";
import notesCss from "../present/notes.css?raw";
import { planOf } from "../present/plan.ts";
import presentCss from "../present/present.css?raw";
import { REVEAL_CSS } from "../present/reveal-css.ts";
import scrollCss from "../present/scroll.css?raw";
import { pageStyles, readPictures } from "./html-assets.ts";
import { assemblePage } from "./html-page.ts";
import { pageScript, revealSource } from "./html-runtime.ts";
import { ExportTree } from "./html-tree.tsx";
import { katexStyles } from "./katex-css.ts";

export interface HtmlOptions {
  /** The file's name; from the deck's title when left out. */
  name?: string;
  /** For tests: the style sheets to read the renderer's rules and fonts from, instead of the page's. */
  sheets?: ArrayLike<CSSStyleSheet>;
}

export interface HtmlExport {
  file: DeliveredFile;
  /** What could not go in the page exactly, in words for a person. */
  warnings: ExportWarning[];
}

const told = (message: string): ExportWarning => ({ slide: null, element: null, message });

/** A name for the file from the deck's title: no characters a file system refuses. */
function fileName(title: string): string {
  const printable = [...title].map((c) => (c.charCodeAt(0) < 32 ? " " : c)).join("");
  const clean = printable.replaceAll(/[\\/:*?"<>|]+/g, " ").replaceAll(/\s+/g, " ").trim().replace(/^\.+/, "");
  return `${clean.slice(0, 80).trim() || "Untitled deck"}.html`;
}

/** Whether a deck holds an element of a kind, at any depth. */
function holds(value: unknown, type: string): boolean {
  if (Array.isArray(value)) return value.some((item) => holds(item, type));
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === type || Object.values(record).some((inner) => inner !== null && typeof inner === "object" && holds(inner, type));
}

/** The deck as a web page. `host` gives the pictures the deck names. */
export async function exportHtml(deck: Deck, host: Pick<SlidesHost, "imageUrl" | "readImage">, options: HtmlOptions = {}): Promise<HtmlExport> {
  const plan = planOf(deck);
  const warnings: ExportWarning[] = [];
  const { found, missing } = await readPictures(host, deck);
  for (const path of missing) warnings.push(told(`The picture ${path} could not be read, so its place is grey.`));

  // Each picture goes in the page once, however many slides show it.
  const pictures: string[] = [];
  const place = new Map<string, number>();
  const imageUrl = (path: string): string | undefined => {
    const data = found.get(path);
    if (data === undefined) return undefined;
    let at = place.get(path);
    if (at === undefined) {
      at = pictures.push(data) - 1;
      place.set(path, at);
    }
    return `ks-img:${at}`;
  };

  const { renderToStaticMarkup } = await import("react-dom/server");
  // React hints the browser to fetch the first pictures (a `<link rel="preload">` for each); here they are stand-ins, filled in by the script.
  const slides = renderToStaticMarkup(createElement(ExportTree, { plan, imageUrl })).replaceAll(/<link\b[^>]*\bks-img:[^>]*>/g, "")
    .replaceAll(/\ssrc="ks-img:(\d+)"/g, ' data-ks-img="$1"');

  const { css: slideCss, missing: fonts } = await pageStyles(slides, deck, options.sheets ? { sheets: options.sheets } : {});
  for (const family of fonts) warnings.push(told(`The font ${family} is not one KastenFlow Slides carries, so the page uses another where it is not installed.`));
  const math = slides.includes('class="katex') ? await katexStyles(slides, options.sheets ? { sheets: options.sheets } : {}) : null;
  if (slides.includes('class="katex') && math === null) warnings.push(told("The formulas are set in the reader's own fonts: the font for them could not be read."));
  if (holds(deck.slides, "video")) warnings.push(told("Videos are not put in the page: it shows their stills."));
  if (holds(deck.slides, "embed")) warnings.push(told("Embedded pages are not run in the page: it shows their stills."));

  const script = pageScript(await revealSource());
  const html = assemblePage({
    title: deck.title,
    css: [REVEAL_CSS, presentCss, scrollCss, notesCss, slideCss, math ?? ""].join("\n"),
    slides,
    script,
    data: {
      title: deck.title,
      size: deck.size,
      effect: deck.present.effect ?? "fade",
      count: plan.count,
      images: pictures,
      slides: plan.columns.flatMap((column, h) => column.slides.map((slide, v) => ({ id: slide.id, number: plan.numbers.get(slide.id) ?? 0, backup: v > 0, h, v }))),
    },
  });
  return { file: { name: options.name ?? fileName(deck.title), bytes: new TextEncoder().encode(html), type: "text/html" }, warnings };
}
