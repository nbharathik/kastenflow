// One page of the reader: a placeholder of the page's size until it comes
// near the view, then its picture (a canvas at the screen's pixel density),
// the source's highlights over it, and pdf.js's text layer on top, whose
// transparent text is what a selection selects. Far pages let go of their
// canvas, so a long PDF keeps a few pages in memory, not all of them.

import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { Highlight } from "../../../lib/vault/types";
import { colorOf } from "../colors";
import { lineBoxes, viewBox, type Box, type Transform } from "../pdf/geometry";
import { pdfjs } from "../pdf/load";

/** A page's size in points. */
export interface PageSize {
  width: number;
  height: number;
}

interface Props {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  /** The first page's size, until this one's is known. */
  fallback: PageSize;
  /** Near the view: drawn. */
  near: boolean;
  highlights: readonly Highlight[];
  flashing: string | null;
  /** The page's transform, for the reader's selections and clicks. */
  onTransform(number: number, transform: Transform): void;
  /** Text the reader's find looks for, marked where it is on this page. */
  find?: string | null;
}

/** Where `query` sits in the page's text layer, as boxes on the page. */
function foundBoxes(page: HTMLElement, layer: HTMLElement, query: string): Box[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase();
    for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      rects.push(...(range.getClientRects?.() ?? []));
    }
  }
  return lineBoxes(rects, page.getBoundingClientRect());
}

export const PdfPage = memo(function PdfPage({ doc, number, scale, fallback, near, highlights, flashing, onTransform, find }: Props) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Counts each time the text layer is drawn, so the find marks follow it.
  const [drawn, setDrawn] = useState(0);
  const [found, setFound] = useState<Box[]>([]);

  useEffect(() => {
    if (!near || page) return;
    let live = true;
    doc.getPage(number).then(
      (p) => live && setPage(p),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [doc, number, near, page]);

  // A page gone far lets go of what pdf.js keeps for drawing it too.
  useEffect(() => {
    if (page && !near) page.cleanup();
  }, [page, near]);

  const viewport: PageViewport | null = useMemo(() => page?.getViewport({ scale }) ?? null, [page, scale]);
  // Until the page is read, it is taken to be the first page's size.
  const transform: Transform = viewport ? (viewport.transform as unknown as Transform) : [scale, 0, 0, -scale, 0, fallback.height * scale];
  const width = viewport?.width ?? fallback.width * scale;
  const height = viewport?.height ?? fallback.height * scale;

  useEffect(() => {
    if (viewport) onTransform(number, viewport.transform as unknown as Transform);
  }, [number, viewport, onTransform]);

  useEffect(() => {
    const picture = canvas.current;
    const layer = text.current;
    if (!page || !viewport || !near || !picture || !layer) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    picture.width = Math.floor(viewport.width * dpr);
    picture.height = Math.floor(viewport.height * dpr);
    const drawing = page.render({ canvas: picture, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
    // A render cancelled by leaving the page rejects; a page that cannot draw stays blank.
    drawing.promise.catch(() => {});
    let words: { cancel(): void } | null = null;
    void pdfjs()
      .then((lib) => {
        if (cancelled) return;
        layer.replaceChildren();
        const textLayer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        words = textLayer;
        return textLayer.render().then(() => !cancelled && setDrawn((n) => n + 1));
      })
      // The text layer is for selecting words; without it the page is still readable.
      .catch(() => {});
    return () => {
      cancelled = true;
      drawing.cancel();
      words?.cancel();
      picture.width = 0;
      picture.height = 0;
      layer.replaceChildren();
    };
  }, [page, viewport, near]);

  useEffect(() => {
    const layer = text.current;
    const el = root.current;
    setFound(find && near && layer && el ? foundBoxes(el, layer, find) : []);
  }, [find, near, drawn]);

  const marks = highlights.flatMap((h) =>
    h.rects.map((rect, i) => {
      const box = viewBox(transform, rect);
      return (
        <div
          key={`${h.id}-${i}`}
          className={`kasten-pdf-mark is-${colorOf(h.color)}${flashing === h.id ? " is-flashing" : ""}`}
          data-highlight={h.id}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      );
    }),
  );

  const style = { width, height, "--scale-factor": scale, "--total-scale-factor": scale, "--user-unit": 1 } as CSSProperties;
  return (
    <div ref={root} className="kasten-pdf-page" data-page={number} style={style} aria-label={`Page ${number}`} role="region">
      <canvas ref={canvas} className="kasten-pdf-canvas" aria-hidden="true" />
      <div className="kasten-pdf-marks" aria-hidden="true">
        {marks}
        {found.map((box, i) => (
          <div key={`found-${i}`} className="kasten-pdf-found" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
        ))}
      </div>
      <div ref={text} className="textLayer kasten-pdf-text" />
      {!page && <span className="kasten-pdf-page-number">{number}</span>}
    </div>
  );
});
