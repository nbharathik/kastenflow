// "Export as HTML file": one self-contained file that shows a smart page
// outside KastenFlow. The kit's styles and scripts and the page's own files
// are put inline, pictures become data addresses, and the data of the moment
// (what the page read, kept by `snapshot.ts`) is carried in the file. The
// bridge is replaced by a read-only stand-in (`export-stub.ts`): the copy
// sends no messages, makes no connection and has no way to write. Its policy
// allows nothing from the network, so a script that tries fails.

import { EXPORT_CSP, START_SOURCE, STUB_SOURCE } from "./export-stub";
import type { SnapshotEntry } from "./snapshot";

export interface ExportInput {
  title: string;
  /** The page's files by path: text, or bytes for a picture. */
  files: Readonly<Record<string, string | Uint8Array>>;
  /** The kit's files by path (`kit.js`, `kit.css`, `lib/dom.js`, ...). */
  kit: Readonly<Record<string, string>>;
  snapshot: readonly SnapshotEntry[];
  /** The day it was saved, `2026-10-23`. */
  day: string;
}

export interface Exported {
  html: string;
  /** Files the page names that could not be put inside (not in the page's folder, or from the web). */
  left: string[];
}

const KIT_URL = /^(?:smart:\/\/kit|https?:\/\/smart\.localhost\/kit)\/[^/]+\/(.+)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The one place the kit posts a message to the window; the copy has none. */
const POST_LINE = 'post: (m) => root.parent.postMessage(m, "*"),';
const NO_POST = 'post: () => { throw new Error("This is a saved copy of the page and cannot send anything."); },';

/** Text that is safe inside a `<script>` or `<style>` element. */
const inline = (text: string): string => text.replace(/<\/(script|style)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** The kit's script with its message to the window taken out. Refuses when any is left. */
export function withoutPosting(source: string, name: string): string {
  const cleaned = source.replace(POST_LINE, NO_POST);
  if (/postMessage/.test(cleaned)) throw new Error(`The kit file ${name} can send messages, so this copy cannot be made safely.`);
  return cleaned;
}

/** Where `address` points: the kit, a file of the page, or somewhere this copy cannot go. */
function target(address: string): { kit: string } | { file: string } | { away: true } {
  const kit = KIT_URL.exec(address);
  if (kit) return { kit: kit[1]!.split(/[?#]/)[0]! };
  if (SCHEME.test(address) || address.startsWith("//") || address.startsWith("/")) return { away: true };
  const clean = address.split(/[?#]/)[0]!.replace(/^\.\//, "");
  return clean.includes("..") ? { away: true } : { file: clean };
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };

function dataAddress(path: string, content: string | Uint8Array): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME[ext];
  if (!type) return null;
  if (typeof content === "string") return `data:${type};charset=utf-8,${encodeURIComponent(content)}`;
  let binary = "";
  for (const byte of content) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
}

const text = (value: string | Uint8Array | undefined): string | null => (typeof value === "string" ? value : null);

/** Builds the saved copy of a page from its files, the kit and the data of the moment. */
export function buildExportHtml(input: ExportInput): Exported {
  const index = text(input.files["index.html"]);
  if (index === null) throw new Error("This page has no index.html to save.");
  const doc = new DOMParser().parseFromString(index, "text/html");
  const left: string[] = [];
  const head = doc.head;

  // Whatever the policy says: nothing that loads another page or program, changes where addresses point,
  // sends the reader away on its own, or pings an address. (Their addresses are not carried along either.)
  for (const gone of Array.from(doc.querySelectorAll("iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], link:not([rel~='stylesheet'])"))) {
    const address = gone.getAttribute("src") ?? gone.getAttribute("href") ?? gone.getAttribute("data");
    if (address) left.push(address);
    gone.remove();
  }
  for (const element of Array.from(doc.querySelectorAll("[ping], [srcset], [formaction]"))) {
    for (const name of ["ping", "srcset", "formaction"]) element.removeAttribute(name);
  }

  // The character set, then the policy before any script or style: nothing from the network, whatever the page does.
  let charset = head.querySelector("meta[charset]");
  if (!charset) {
    charset = doc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
  }
  head.insertBefore(charset, head.firstChild);
  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", EXPORT_CSP);
  charset.after(policy);
  if (!doc.title) {
    const title = doc.createElement("title");
    title.textContent = input.title;
    head.appendChild(title);
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const where = target(link.getAttribute("href") ?? "");
    const css = "kit" in where ? input.kit[where.kit] : "file" in where ? text(input.files[where.file]) : undefined;
    if (css === undefined || css === null) {
      left.push(link.getAttribute("href") ?? "");
      link.remove();
      continue;
    }
    const style = doc.createElement("style");
    style.textContent = inline(css);
    link.replaceWith(style);
  }

  let started = false;
  const pre = doc.createElement("script");
  const saved = JSON.stringify(input.snapshot).replace(/</g, "\\u003c");
  pre.textContent = STUB_SOURCE.replace("__DATA__", () => saved);
  policy.after(pre);
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    const src = script.getAttribute("src") ?? "";
    const where = target(src);
    let code = "kit" in where ? input.kit[where.kit] : "file" in where ? text(input.files[where.file]) : undefined;
    if (code === undefined || code === null) {
      left.push(src);
      script.remove();
      continue;
    }
    const isKit = "kit" in where;
    if (isKit) code = withoutPosting(code, src);
    const own = doc.createElement("script");
    own.textContent = inline(code);
    script.replaceWith(own);
    // The kit starts on the stand-in right after its own script has run.
    if (isKit && "kit" in where && where.kit === "kit.js" && !started) {
      const start = doc.createElement("script");
      start.textContent = START_SOURCE;
      own.after(start);
      started = true;
    }
  }

  for (const img of Array.from(doc.querySelectorAll("img[src]"))) {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("data:")) continue;
    const where = target(src);
    const content = "file" in where ? input.files[where.file] : undefined;
    const address = content === undefined || !("file" in where) ? null : dataAddress(where.file, content);
    if (address === null) {
      left.push(src);
      img.removeAttribute("src");
    } else {
      img.setAttribute("src", address);
    }
  }

  const note = `<!-- A saved copy of “${input.title.replace(/--+/g, "-")}” from KastenFlow, ${input.day}. It shows the data of that day and cannot change anything. -->\n`;
  return { html: `<!doctype html>\n${note}${doc.documentElement.outerHTML}\n`, left };
}
