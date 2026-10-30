// Printing a deck, and so "Save as PDF": every slide laid out one to a page, at its
// own size, with live text (the browser prints it as vector). The layout is put in
// the page only while the print dialog is open; the rest of the window is hidden
// from the printer and comes back after.

import type { Deck, Slide } from "@kasten-slides/wasm";
import { createRoot } from "react-dom/client";

import type { ImageUrl } from "../render/index.ts";
import { SlideView } from "../render/index.ts";
// Formulas must be drawn when the pages are, so KaTeX is loaded with this file.
import "../render/math.ts";

export interface PrintOptions {
  /** `final`: each slide once, as it ends. `each`: a page for every step of a slide that has steps. */
  steps: "final" | "each";
  /** A handout: the slide on the upper half of a portrait page with its speaker notes under it. */
  notes: boolean;
}

export const DEFAULT_PRINT: PrintOptions = { steps: "final", notes: false };

/** One page of the printout. */
export interface PrintPage {
  slide: Slide;
  /** The step drawn; undefined for a slide without steps. */
  step: number | undefined;
  /** Its place among the slides printed, from 1. */
  number: number;
}

/** The pages a deck prints as: hidden slides are left out, backup slides stay. */
export function pagesOf(deck: Deck, options: PrintOptions): PrintPage[] {
  const pages: PrintPage[] = [];
  const shown = deck.slides.filter((slide) => !slide.hidden);
  shown.forEach((slide, index) => {
    const steps = slide.steps ?? 0;
    if (steps > 0 && options.steps === "each") {
      for (let step = 0; step <= steps; step++) pages.push({ slide, step, number: index + 1 });
    } else {
      pages.push({ slide, step: steps > 0 ? steps : undefined, number: index + 1 });
    }
  });
  return pages;
}

/** A4 portrait in CSS pixels, for handouts. */
const HANDOUT = { w: 794, h: 1123 };
const HANDOUT_SCALE = 0.75;

const cssFor = (deck: Deck, options: PrintOptions): string => {
  const w = options.notes ? HANDOUT.w : deck.size.w;
  const h = options.notes ? HANDOUT.h : deck.size.h;
  return `
    @page { size: ${w}px ${h}px; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: none !important; }
      body > *:not(.ks-print-root) { display: none !important; }
      .ks-print-root { display: block !important; }
    }
    .ks-print-root { display: none; }
    .ks-print-page { position: relative; width: ${w}px; height: ${h}px; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
    .ks-print-page:last-child { break-after: auto; page-break-after: auto; }
    .ks-print-slide { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .ks-print-notes { position: absolute; left: 48px; right: 48px; font: 13px/1.5 system-ui, sans-serif; color: #222; white-space: pre-wrap; overflow: hidden; }
    .ks-print-notes h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #777; }
  `;
};

function Pages({ deck, options, imageUrl }: { deck: Deck; options: PrintOptions; imageUrl: ImageUrl }) {
  const pages = pagesOf(deck, options);
  const count = deck.slides.filter((s) => !s.hidden).length;
  return (
    <>
      {pages.map((page, i) => (
        <section key={`${page.slide.id}:${page.step ?? "-"}:${i}`} className="ks-print-page" data-slide={page.slide.id} data-step={page.step}>
          <div
            className="ks-print-slide"
            style={options.notes ? { left: (HANDOUT.w - deck.size.w * HANDOUT_SCALE) / 2, top: 48, transform: `scale(${HANDOUT_SCALE})`, outline: "1px solid #c8c8c8" } : undefined}
          >
            <SlideView deck={deck} slide={page.slide} number={page.number} count={count} step={page.step} mode="export" imageUrl={imageUrl} />
          </div>
          {options.notes ? (
            <div className="ks-print-notes" style={{ top: 48 + deck.size.h * HANDOUT_SCALE + 32, bottom: 48 }}>
              <h4>Speaker notes · slide {page.number}</h4>
              {page.slide.notes ?? ""}
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}

/** Waits for the fonts and the pictures of the layout, so the printout is not drawn half empty. */
async function ready(root: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  await Promise.all(
    [...root.querySelectorAll("img")].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((done) => {
            img.addEventListener("load", () => done(), { once: true });
            img.addEventListener("error", () => done(), { once: true });
          }),
    ),
  );
}

/**
 * Puts the printout in the page, hidden on screen and the only thing printed. Resolves
 * to a function that takes it out again.
 */
export async function mountPrintLayout(deck: Deck, imageUrl: ImageUrl, options: PrintOptions = DEFAULT_PRINT): Promise<() => void> {
  const style = document.createElement("style");
  style.dataset.ksPrint = "";
  style.textContent = cssFor(deck, options);
  const host = document.createElement("div");
  host.className = "ks-print-root";
  document.head.append(style);
  document.body.append(host);
  const root = createRoot(host);
  root.render(<Pages deck={deck} options={options} imageUrl={imageUrl} />);
  // Let React commit before looking for pictures.
  await new Promise((done) => setTimeout(done, 0));
  await ready(host);
  return () => {
    root.unmount();
    host.remove();
    style.remove();
  };
}

/** Opens the browser's print dialog on the printout ("Save as PDF" is one of its destinations); takes the layout out when it closes. */
export async function printDeck(deck: Deck, imageUrl: ImageUrl, options: PrintOptions = DEFAULT_PRINT): Promise<void> {
  const unmount = await mountPrintLayout(deck, imageUrl, options);
  const finished = new Promise<void>((done) => {
    window.addEventListener("afterprint", () => done(), { once: true });
    // A browser that never says the dialog closed must not leave the layout in the page for ever.
    setTimeout(done, 10 * 60_000);
  });
  window.print();
  await finished;
  unmount();
}
