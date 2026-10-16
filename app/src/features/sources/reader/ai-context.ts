// A PDF as the AI's context: the chip that names pages and highlights of
// it, and the text of those pages, which only the window can read (pdf.js is
// here; the backend has no PDF reader). At most 10 pages and 30,000
// characters go with a message, and the backend cuts them again, so what it
// is sent is never more than this says.

import type { PDFDocumentProxy } from "pdfjs-dist";

import type { Chip } from "../../chat/thread";
import type { Excerpt } from "../../chat/types";
import { useWorkspace } from "../../workspace/store";
import { openPdf } from "../pdf/load";

/** The most pages whose text goes with a message. */
export const MAX_PAGES = 10;
/** The most characters of page text. */
export const MAX_CHARS = 30_000;
/** The highest page number read, so a typed range never expands without end. */
const LAST_PAGE = 10_000;

/** Page numbers from a list such as `3-5, 8`: sorted, each once. Anything
 * else is an error, said in words. */
export function parsePages(spec: string): number[] {
  const out = new Set<number>();
  if (!spec.trim()) return [];
  const number = (text: string) => {
    if (!/^\d{1,5}$/.test(text.trim())) throw new Error(`“${text.trim()}” is not a page number`);
    const page = Number(text);
    if (page < 1 || page > LAST_PAGE) throw new Error(`Page ${page} is out of range`);
    return page;
  };
  for (const item of spec.split(",")) {
    const [from, to, ...more] = item.split("-");
    if (more.length > 0 || from === undefined) throw new Error(`“${item.trim()}” is not a page or a range of pages`);
    const first = number(from);
    const last = to === undefined ? first : number(to);
    if (last < first) throw new Error(`“${item.trim()}” runs backwards`);
    for (let page = first; page <= last; page++) out.add(page);
  }
  return [...out].sort((a, b) => a - b);
}

/** Pages written short: `1-3, 7`. */
export function pagesLabel(pages: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j;
  }
  return parts.join(", ");
}

/** The chip for pages and highlights of `source`; `highlights` are ids, or "all". */
export function pdfChip(source: string, title: string, pages: readonly number[], highlights: readonly string[] | "all" = []): Chip {
  const ref = [source];
  if (pages.length > 0) ref.push(`pages:${pagesLabel(pages).replaceAll(", ", ",")}`);
  const picked = highlights === "all" ? "all" : highlights.join(",");
  if (picked) ref.push(`highlights:${picked}`);
  const where = pages.length > 0 ? `${pages.length === 1 ? "p." : "pp."} ${pagesLabel(pages)}` : "";
  const marked = highlights === "all" ? "highlights" : highlights.length > 0 ? `${highlights.length} ${highlights.length === 1 ? "highlight" : "highlights"}` : "";
  return { kind: "pdf", label: [title, [where, marked].filter(Boolean).join(" + ")].filter(Boolean).join(" · "), ref };
}

/** A page's text: its lines as pdf.js has them, spaces collapsed. */
export async function pageText(doc: PDFDocumentProxy, number: number): Promise<string> {
  const content = await (await doc.getPage(number)).getTextContent();
  let line = "";
  const lines: string[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    line += item.str;
    if (item.hasEOL) {
      lines.push(line);
      line = "";
    } else if (item.str && !item.str.endsWith(" ")) line += " ";
  }
  lines.push(line);
  return lines
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** The text of `pages` of `doc`, which is `source`: refused past the most pages, and cut at the most characters. */
export async function readPages(doc: PDFDocumentProxy, source: string, pages: readonly number[]): Promise<Excerpt[]> {
  if (pages.length > MAX_PAGES) throw new Error(`Choose at most ${MAX_PAGES} pages at a time; ${pages.length} were named`);
  const past = pages.find((page) => page > doc.numPages);
  if (past !== undefined) throw new Error(`This PDF has ${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}, so there is no page ${past}`);
  const out: Excerpt[] = [];
  let room = MAX_CHARS;
  for (const page of pages) {
    if (room <= 0) break;
    const text = (await pageText(doc, page)).slice(0, room);
    room -= text.length;
    out.push({ source, page, text });
  }
  return out;
}

/** The text of the pages the `pdf` chips in `chips` name. Each PDF is opened once. */
export async function excerptsOf(chips: readonly Chip[]): Promise<Excerpt[]> {
  const client = useWorkspace.getState().client;
  const out: Excerpt[] = [];
  const open = new Map<string, PDFDocumentProxy>();
  try {
    for (const chip of chips) {
      if (chip.kind !== "pdf") continue;
      const [source, ...rest] = chip.ref;
      const spec = rest.find((item) => item.startsWith("pages:"))?.slice("pages:".length);
      if (!source || !spec) continue;
      const pages = parsePages(spec);
      if (!client) throw new Error("No vault is open to read the PDF from");
      let doc = open.get(source);
      if (!doc) {
        doc = await openPdf(await client.readSource(source));
        open.set(source, doc);
      }
      out.push(...(await readPages(doc, source, pages)));
    }
  } finally {
    for (const doc of open.values()) void doc.loadingTask.destroy();
  }
  return out;
}
