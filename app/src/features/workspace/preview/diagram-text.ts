// What the browser preview's diagrams need of kasten-core's `diagrams` module
// (crates/kasten-core/src/diagrams): the checks of a source and a picture, the
// stamp that ties a picture to its source, reading a picture or a PNG the
// editor exported, and keeping links to a file where they went. The core does
// all of this inside the app; the preview does it with the browser's XML
// parser.

import { linkSpans } from "../links";

export const MAX_BYTES = 5 * 1024 * 1024;

const STAMP_OPEN = "<!-- kasten-source: ";
const STAMP_CLOSE = " -->";

const tooLarge = (what: string, length: number) => new Error(`This ${what} is too large (${(length / (1024 * 1024)).toFixed(1)} MB); the limit is 5 MB`);

/** The XML document of `text`, or why it is not well formed. */
function parse(text: string): Document {
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) throw new Error("a DOCTYPE or other declaration is not allowed");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const problem = doc.getElementsByTagName("parsererror")[0];
  if (problem) throw new Error((problem.textContent ?? "not well formed").split("\n")[0]!.trim());
  return doc;
}

/** How many pages a well-formed diagram has; throws why it is not one. */
export function checkXml(xml: string): number {
  if (xml.length > MAX_BYTES) throw tooLarge("diagram", xml.length);
  let doc: Document;
  try {
    doc = parse(xml);
  } catch (err) {
    throw new Error(`Not a well-formed diagram. ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  const root = doc.documentElement.nodeName;
  if (root === "mxfile") return doc.getElementsByTagName("diagram").length;
  if (root === "mxGraphModel") return 1;
  throw new Error(`This is not a diagram: its root element is <${root}>, not <mxfile>`);
}

/** Throws unless `svg` is a well-formed SVG with nothing in it that runs. */
export function checkSvg(svg: string): void {
  if (svg.length > MAX_BYTES) throw tooLarge("picture", svg.length);
  let doc: Document;
  try {
    doc = parse(svg);
  } catch (err) {
    throw new Error(`Not a well-formed picture. ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (doc.documentElement.nodeName !== "svg") throw new Error(`This is not an SVG picture: its root element is <${doc.documentElement.nodeName}>`);
  if (Array.from(doc.getElementsByTagName("*")).some((e) => e.localName.toLowerCase() === "script")) throw new Error("A picture of a diagram may not hold a script element");
}

function withoutStamp(svg: string): string {
  const end = svg.lastIndexOf("</svg>");
  const at = svg.lastIndexOf(STAMP_OPEN);
  return end >= 0 && at > end ? svg.slice(0, at) : svg;
}

/** `svg` with a trailing comment naming the hash of the source it was drawn from. */
export const stamped = (svg: string, hash: string): string => `${withoutStamp(svg).trimEnd()}\n${STAMP_OPEN}${hash}${STAMP_CLOSE}\n`;

/** The hash a picture was stamped with. */
export function stampOf(svg: string): string | null {
  const end = svg.lastIndexOf("</svg>");
  const at = svg.lastIndexOf(STAMP_OPEN);
  if (end < 0 || at <= end) return null;
  const rest = svg.slice(at + STAMP_OPEN.length);
  const stop = rest.indexOf(STAMP_CLOSE);
  return stop < 0 ? null : rest.slice(0, stop);
}

/** The diagram an editor-made picture carries in its `content` attribute. */
export function contentOfSvg(svg: string): string | null {
  try {
    return parse(svg).documentElement.getAttribute("content");
  } catch {
    return null;
  }
}

/** The diagram the editor keeps in a PNG's `mxfile` text chunk, percent-encoded. */
export function diagramInPng(bytes: Uint8Array): string | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 8 + length;
    if (end + 4 > bytes.length) return null;
    if (kind === "tEXt") {
      const data = bytes.subarray(at + 8, end);
      const nul = data.indexOf(0);
      if (nul >= 0 && String.fromCharCode(...data.subarray(0, nul)) === "mxfile") {
        try {
          // The chunk's text is already percent-encoded ASCII.
          return decodeURIComponent(new TextDecoder("latin1").decode(data.subarray(nul + 1)));
        } catch {
          return null;
        }
      }
    }
    if (kind === "IEND") return null;
    at = end + 4;
  }
  return null;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** `body` with each link to `old` naming `next` instead, or null when none did. A link by file name alone follows only
 * when `bareFollows` (nothing else has that file name). Heading and alias stay (links.rs). */
export function retarget(body: string, old: string, next: string, bareFollows: boolean): string | null {
  let out = "";
  let last = 0;
  for (const [start, end] of linkSpans(body)) {
    const inner = body.slice(start, end);
    const cut = inner.search(/[|#]/);
    const raw = cut < 0 ? inner : inner.slice(0, cut);
    const target = raw.trim();
    const replacement = target === old ? next : bareFollows && target.toLowerCase() === nameOf(old).toLowerCase() ? nameOf(next) : null;
    if (replacement === null) continue;
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const trail = raw.slice(raw.trimEnd().length);
    out += body.slice(last, start) + lead + replacement + trail;
    last = start + raw.length;
  }
  return last === 0 ? null : out + body.slice(last);
}
