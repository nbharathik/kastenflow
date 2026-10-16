// What attachments need from the window: a canvas to scale pictures with, and
// pdf.js (loaded when the first PDF is attached) to read a PDF's first pages.
// Kept apart from attachments.ts so its rules are tested without either.

import type { AttachDeps, ImageSource, PdfText } from "./attachments";

async function decodeImage(bytes: Uint8Array, mime: string): Promise<ImageSource> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: mime }));
  return {
    width: bitmap.width,
    height: bitmap.height,
    async encode(width, height, type, quality) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas to draw the picture on");
      // A JPEG has no transparency: what was clear becomes white, not black.
      if (type === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
      if (!blob) throw new Error("The picture could not be written");
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

async function readPdf(bytes: Uint8Array, name: string): Promise<PdfText> {
  const [{ openPdf }, { readPages, MAX_PAGES, MAX_CHARS }] = await Promise.all([import("../sources/pdf/load"), import("../sources/reader/ai-context")]);
  const doc = await openPdf(bytes);
  try {
    const wanted = Array.from({ length: Math.min(doc.numPages, MAX_PAGES) }, (_, i) => i + 1);
    const excerpts = await readPages(doc, name, wanted);
    const chars = excerpts.reduce((sum, e) => sum + e.text.length, 0);
    return {
      text: excerpts.map((e) => `--- Page ${e.page} ---\n${e.text}`).join("\n\n"),
      first: excerpts[0]?.page ?? 1,
      last: excerpts[excerpts.length - 1]?.page ?? 1,
      total: doc.numPages,
      cut: excerpts.length < wanted.length || chars >= MAX_CHARS,
    };
  } finally {
    void doc.loadingTask.destroy();
  }
}

/** The window's canvas, pdf.js and clock. */
export const browserDeps: AttachDeps = { decodeImage, readPdf, now: () => new Date() };
