// The real PDF library for the preview: pdf.js, loaded with the first PDF
// (features/sources/pdf/load.ts), drawing a page into a canvas at the
// screen's pixel density so text stays sharp.

import type { PDFPageProxy } from "pdfjs-dist";

import { openPdf } from "../../../features/sources/pdf/load";
import type { PreviewDeps } from "./controller";

export const pdfDeps: PreviewDeps = {
  async open(bytes) {
    const doc = await openPdf(bytes);
    // Letting the document go is the loading task's job.
    return { numPages: doc.numPages, getPage: (n) => doc.getPage(n), destroy: () => doc.loadingTask.destroy() };
  },
  async paint(page, scale, canvas) {
    const real = page as PDFPageProxy;
    const density = Math.min(3, window.devicePixelRatio || 1);
    const viewport = real.getViewport({ scale: scale * density });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / density)}px`;
    canvas.style.height = `${Math.floor(viewport.height / density)}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This window cannot draw the PDF");
    await real.render({ canvas, canvasContext: context, viewport }).promise;
  },
};
