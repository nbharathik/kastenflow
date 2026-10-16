// `kasten:` addresses: a link to a place inside the vault that survives the
// renames and moves a path would not. They only ever open something; a link
// never changes the vault, and one to something missing or trashed says so.
//
//   kasten:note/<id>#<heading>                     a page, at a heading
//   kasten:note/<id>?section=<title>&n=<nth>       the nth heading with that title
//   kasten:pdf/<vault path>?page=12&highlight=<id> a PDF at a page (and a highlight)
//   kasten:board/<vault path>?node=<id>            a whiteboard (and a card or section on it)
//   kasten:deck/<id or vault path>?slide=<id>      a deck (and a slide)

export type KastenLink =
  | { kind: "note"; id: string; heading?: string; nth?: number }
  | { kind: "pdf"; path: string; page: number; highlight?: string }
  | { kind: "board"; path: string; node?: string }
  | { kind: "deck"; ref: string; slide?: string };

const SCHEME = /^kasten:(note|pdf|board|deck)\//i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAGE = 100_000;
const MAX_TEXT = 500;

/** Whether `href` is one of the addresses this file reads (a `kasten:settings/...` address is another thing). */
export const isKastenLink = (href: string): boolean => SCHEME.test(href.trim());

/** Encodes a piece of an address so it can sit in a Markdown link's destination: no space, bracket or parenthesis is left bare. */
function encode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const encodePath = (path: string): string => path.split("/").map(encode).join("/");

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** A vault path an address may name: plain, forward slashes, nothing that climbs out. */
function plainPath(path: string, ending: string): boolean {
  if (path === "" || path.length > 1024 || path.startsWith("/") || path.includes("\\") || path.includes("\0") || !path.toLowerCase().endsWith(ending)) return false;
  // eslint-disable-next-line no-control-regex -- control characters are never part of a path
  if (/[\u0000-\u001f]/.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** `kasten:note/<id>`, with a heading or the nth heading of a title. */
export const noteLink = (id: string, heading?: string, nth = 1): string => {
  const base = `kasten:note/${encode(id)}`;
  if (!heading) return base;
  return nth > 1 ? `${base}?section=${encode(heading)}&n=${nth}` : `${base}#${encode(heading)}`;
};

export const pdfLink = (path: string, page: number, highlight?: string): string => `kasten:pdf/${encodePath(path)}?page=${Math.max(1, Math.trunc(page))}${highlight ? `&highlight=${encode(highlight)}` : ""}`;

export const boardLink = (path: string, node?: string): string => `kasten:board/${encodePath(path)}${node ? `?node=${encode(node)}` : ""}`;

export const deckLink = (ref: string, slide?: string): string => `kasten:deck/${ref.includes("/") || ref.includes(".") ? encodePath(ref) : encode(ref)}${slide ? `?slide=${encode(slide)}` : ""}`;

/** The address of a link, written out. */
export function formatKastenLink(link: KastenLink): string {
  switch (link.kind) {
    case "note":
      return noteLink(link.id, link.heading, link.nth);
    case "pdf":
      return pdfLink(link.path, link.page, link.highlight);
    case "board":
      return boardLink(link.path, link.node);
    case "deck":
      return deckLink(link.ref, link.slide);
  }
}

/** The query's parameters, by name; a name twice is the first. */
function params(query: string): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const part of query.split("&")) {
    if (part === "") continue;
    const at = part.indexOf("=");
    const name = decode(at < 0 ? part : part.slice(0, at));
    const value = decode(at < 0 ? "" : part.slice(at + 1));
    if (name === null || value === null) return null;
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/** Reads an address; null for one this version cannot open (an unknown kind, a path that climbs, a number that is not one). */
export function parseKastenLink(href: string): KastenLink | null {
  const text = href.trim();
  const kind = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (!kind) return null;
  const rest = text.slice("kasten:".length + kind.length + 1);
  const hash = rest.indexOf("#");
  const afterHash = hash < 0 ? "" : rest.slice(hash + 1);
  const beforeHash = hash < 0 ? rest : rest.slice(0, hash);
  const mark = beforeHash.indexOf("?");
  const target = decode(mark < 0 ? beforeHash : beforeHash.slice(0, mark));
  const query = params(mark < 0 ? "" : beforeHash.slice(mark + 1));
  if (target === null || query === null) return null;
  const idOf = (name: string): string | undefined => {
    const value = query.get(name);
    return value !== undefined && ID.test(value) ? value : undefined;
  };
  if (kind === "note") {
    if (!ID.test(target)) return null;
    const section = query.get("section");
    if (section !== undefined) {
      const heading = section.trim();
      const n = Number(query.get("n") ?? "1");
      if (heading === "" || heading.length > MAX_TEXT || !Number.isInteger(n) || n < 1 || n > 1000) return null;
      return { kind: "note", id: target, heading, ...(n > 1 ? { nth: n } : {}) };
    }
    const heading = afterHash === "" ? null : decode(afterHash)?.trim();
    if (heading === undefined || (heading !== null && heading.length > MAX_TEXT)) return null;
    return heading ? { kind: "note", id: target, heading } : { kind: "note", id: target };
  }
  if (kind === "pdf") {
    const page = Number(query.get("page") ?? "1");
    if (!plainPath(target, ".pdf") || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) return null;
    const highlight = idOf("highlight");
    return { kind: "pdf", path: target, page, ...(highlight ? { highlight } : {}) };
  }
  if (kind === "board") {
    if (!plainPath(target, ".canvas")) return null;
    const node = idOf("node");
    return { kind: "board", path: target, ...(node ? { node } : {}) };
  }
  // A deck is named by its id or by its path.
  if (!ID.test(target) && !plainPath(target, ".deck")) return null;
  const slide = idOf("slide");
  return { kind: "deck", ref: target, ...(slide ? { slide } : {}) };
}
