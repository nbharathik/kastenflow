// Turning what a person pastes, drops or picks into attachments the assistant
// can read: text (a long paste, a text file, a PDF's pages), or a picture
// scaled to a size a model takes. Pure but for the `AttachDeps` it is given
// (the window's canvas and pdf.js, in attach-browser.ts), so every rule is
// tested without a window. A file that cannot be used is refused in a plain
// sentence, never dropped quietly.

import { keptName } from "../../lib/vault/assets";
import type { AttachKind } from "./agent-types";

/** At most this many attachments go with one message. */
export const MAX_ATTACHMENTS = 5;
/** A paste longer than this many characters, or lines, becomes an attachment. */
export const LONG_PASTE_CHARS = 2000;
export const LONG_PASTE_LINES = 40;
/** The largest text file taken, and the most characters of it that go on (the backend cuts there too). */
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
/** A picture goes as at most this many pixels on its longest side and this many bytes. */
export const MAX_IMAGE_SIDE = 2048;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** The largest file read at all, picture or PDF, before it is made smaller. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
/** How many pages of a PDF, and characters of them, go (as in the reader's "ask about pages"). */
export const PDF_PAGES = 10;
export const PDF_CHARS = 30_000;

/** An attachment made ready to keep: the bytes `chat_attach` takes, and what to show. */
export interface Prepared {
  name: string;
  kind: AttachKind;
  mime: string;
  bytes: Uint8Array;
  chars?: number;
  width?: number;
  height?: number;
  /** Pasted: "Pasted text · N chars", and it can go back into the box as text. */
  pasted?: boolean;
  /** Something done to it the person should know: cut, scaled, pages left out. */
  note?: string;
}

/** A picture decoded in the window, and how to draw it again at another size. */
export interface ImageSource {
  width: number;
  height: number;
  encode(width: number, height: number, mime: "image/png" | "image/jpeg", quality: number): Promise<Uint8Array>;
}

/** The text of a PDF's first pages. */
export interface PdfText {
  text: string;
  first: number;
  last: number;
  /** All the pages it has. */
  total: number;
  /** The characters ran out before the pages did. */
  cut: boolean;
}

/** What the window gives: a canvas, pdf.js and the clock. */
export interface AttachDeps {
  decodeImage(bytes: Uint8Array, mime: string): Promise<ImageSource>;
  readPdf(bytes: Uint8Array, name: string): Promise<PdfText>;
  now(): Date;
}

/** A file that cannot be attached; the message is a sentence for the person. */
export class AttachRefused extends Error {}

/** The pictures a model sees. */
const SEEN = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const SEEN_BY_ENDING: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const OTHER_PICTURES = new Set(["heic", "heif", "avif", "bmp", "tif", "tiff", "ico", "jfif", "jxl", "apng"]);
const TEXT_ENDINGS = new Set(
  "md markdown txt text csv tsv json jsonl yaml yml toml ini cfg conf log xml html htm css scss sass less js mjs cjs ts tsx jsx py rs go java kt c h cc cpp hpp cs rb php sh bash zsh fish ps1 bat cmd sql tex bib rst org adoc lua swift r jl scala dart vue svelte gradle env diff patch proto graphql gql tf hcl ipynb srt vtt".split(" "),
);
const TEXT_TYPE = /^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|sql)$|\+(json|xml|yaml)$/;
const ending = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** What kind of file `file` is, by its type and then its ending. SVG is text. */
export function classify(file: { name: string; type: string }): "image" | "picture-unsupported" | "pdf" | "text" | "other" {
  const type = file.type.toLowerCase();
  const end = ending(file.name);
  if (type === "application/pdf" || end === "pdf") return "pdf";
  if (type === "image/svg+xml" || end === "svg") return "text";
  if (SEEN.has(type) || (!type.startsWith("image/") && end in SEEN_BY_ENDING)) return "image";
  if (type.startsWith("image/") || OTHER_PICTURES.has(end)) return "picture-unsupported";
  if (type.startsWith("text/") || TEXT_TYPE.test(type) || TEXT_ENDINGS.has(end)) return "text";
  return "other";
}

/** Whether a pasted text is long enough to be an attachment and not typed into the box. */
export function shouldAttachPaste(text: string): boolean {
  return text.length > LONG_PASTE_CHARS || text.split("\n").length > LONG_PASTE_LINES;
}

const count = (text: string) => (/[\ud800-\udfff]/.test(text) ? Array.from(text).length : text.length);

/** `n` with thousands separators. */
const grouped = (n: number) => n.toLocaleString("en-US");

/** A size in bytes, short: `812 B`, `4 KB`, `1.2 MB`. */
export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  const round = (n: number) => (n >= 10 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ""));
  if (size < 1024 * 1024) return `${round(size / 1024)} KB`;
  return `${round(size / 1024 / 1024)} MB`;
}

/** What an attachment's chip says. */
export function labelOf(item: Pick<Prepared, "name" | "bytes" | "pasted" | "chars">): string {
  if (item.pasted) return `${item.name} · ${grouped(item.chars ?? 0)} chars`;
  return `${item.name} · ${formatSize(item.bytes.length)}`;
}

/** Text as an attachment: cut at the most the assistant reads. */
function textAttachment(name: string, text: string, rest: Partial<Prepared> = {}): Prepared {
  const total = count(text);
  const cut = total > MAX_TEXT_CHARS;
  const kept = cut ? Array.from(text).slice(0, MAX_TEXT_CHARS).join("") : text;
  const note = cut ? `Cut to the first ${grouped(MAX_TEXT_CHARS)} characters of ${grouped(total)}.` : undefined;
  return { name, kind: "text", mime: "text/plain", bytes: new TextEncoder().encode(kept), chars: cut ? MAX_TEXT_CHARS : total, ...(note ? { note } : {}), ...rest };
}

/** A long paste as an attachment. */
export const pastedText = (text: string): Prepared => textAttachment("Pasted text", text, { pasted: true });

const quoted = (name: string) => `“${name}”`;
const CAN_READ = "Attach text, a PDF or a picture (PNG, JPEG, GIF or WebP).";

/** The text of a file, or why it is not text. `known` says the ending or type promised text. */
function decodeText(name: string, bytes: Uint8Array, known: boolean): string {
  const unreadable = new AttachRefused(`${quoted(name)} isn't a kind of file the assistant can read here. ${CAN_READ}`);
  if (bytes.includes(0)) throw known ? new AttachRefused(`${quoted(name)} holds more than text, so the assistant can't read it. ${CAN_READ}`) : unreadable;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw known ? new AttachRefused(`${quoted(name)} isn't text in UTF-8, so the assistant can't read it. Save it as UTF-8 and attach it again.`) : unreadable;
  }
}

async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

const swapEnding = (name: string, to: string) => (/\.[^./\\]+$/.test(name) ? name.replace(/\.[^./\\]+$/, `.${to}`) : `${name}.${to}`);

/** The formats and qualities tried at each size: PNG first for anything that may be transparent. */
const attempts = (mime: string): ["image/png" | "image/jpeg", number][] =>
  mime === "image/jpeg"
    ? [["image/jpeg", 0.9], ["image/jpeg", 0.8], ["image/jpeg", 0.7]]
    : [["image/png", 1], ["image/jpeg", 0.9], ["image/jpeg", 0.8], ["image/jpeg", 0.7]];

async function pictureAttachment(name: string, mime: string, bytes: Uint8Array, deps: AttachDeps): Promise<Prepared> {
  let source: ImageSource;
  try {
    source = await deps.decodeImage(bytes, mime);
  } catch {
    throw new AttachRefused(`${quoted(name)} could not be opened as a picture.`);
  }
  const longest = Math.max(source.width, source.height);
  if (longest <= MAX_IMAGE_SIDE && bytes.length <= MAX_IMAGE_BYTES) return { name, kind: "image", mime, bytes, width: source.width, height: source.height };
  const scale = Math.min(1, MAX_IMAGE_SIDE / longest);
  let width = Math.max(1, Math.round(source.width * scale));
  let height = Math.max(1, Math.round(source.height * scale));
  for (let round = 0; round < 8; round++) {
    for (const [type, quality] of attempts(mime)) {
      const out = await source.encode(width, height, type, quality);
      if (out.length > MAX_IMAGE_BYTES) continue;
      const parts = [
        width !== source.width || height !== source.height ? `Scaled down to ${width} × ${height} pixels` : "",
        type !== mime ? `kept as ${type === "image/jpeg" ? "JPEG" : "PNG"}` : "",
        mime === "image/gif" ? "only the first frame is kept" : "",
      ].filter(Boolean);
      const note = parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : undefined;
      return { name: type === mime ? name : swapEnding(name, type === "image/jpeg" ? "jpg" : "png"), kind: "image", mime: type, bytes: out, width, height, ...(note ? { note } : {}) };
    }
    width = Math.max(1, Math.floor(width * 0.75));
    height = Math.max(1, Math.floor(height * 0.75));
  }
  throw new AttachRefused(`${quoted(name)} is too heavy to send as a picture, even made smaller. Try a smaller picture.`);
}

const pagesWord = (first: number, last: number) => (first === last ? `page ${first}` : `pages ${first}–${last}`);

async function pdfAttachment(name: string, bytes: Uint8Array, deps: AttachDeps): Promise<Prepared> {
  let read: PdfText;
  try {
    read = await deps.readPdf(bytes, name);
  } catch {
    throw new AttachRefused(`${quoted(name)} could not be opened as a PDF.`);
  }
  if (!read.text.trim()) throw new AttachRefused(`${quoted(name)} has no text the assistant can read: it may be a scan. Attach its pages as pictures instead.`);
  const all = read.first === 1 && read.last === read.total;
  const note = read.cut ? `Stopped at ${grouped(PDF_CHARS)} characters (${pagesWord(read.first, read.last)} of ${read.total}).` : all ? undefined : `Read ${pagesWord(read.first, read.last)} of ${read.total}.`;
  return textAttachment(`${name} (${pagesWord(read.first, read.last)})`, read.text, note ? { note } : {});
}

/** `file` as an attachment, or an `AttachRefused` saying in a sentence why not. */
export async function prepare(file: File, deps: AttachDeps): Promise<Prepared> {
  const name = keptName(file, deps.now());
  const kind = classify(file);
  if (kind === "picture-unsupported") throw new AttachRefused(`${quoted(name)} is a kind of picture the assistant can't see here. It can see PNG, JPEG, GIF and WebP pictures.`);
  if (kind === "other" && file.size > MAX_TEXT_BYTES) throw new AttachRefused(`${quoted(name)} isn't a kind of file the assistant can read here. ${CAN_READ}`);
  if (kind === "text" && file.size > MAX_TEXT_BYTES) throw new AttachRefused(`${quoted(name)} is ${formatSize(file.size)}; the assistant reads text files up to 1 MB. Attach the part you need.`);
  if ((kind === "image" || kind === "pdf") && file.size > MAX_SOURCE_BYTES) throw new AttachRefused(`${quoted(name)} is ${formatSize(file.size)}, more than the ${formatSize(MAX_SOURCE_BYTES)} the window reads.`);
  const bytes = await readBytes(file);
  if (kind === "image") {
    const type = file.type.toLowerCase();
    return pictureAttachment(name, SEEN.has(type) ? type : (SEEN_BY_ENDING[ending(name)] ?? "image/png"), bytes, deps);
  }
  if (kind === "pdf") return pdfAttachment(name, bytes, deps);
  return textAttachment(name, decodeText(name, bytes, kind === "text"));
}
