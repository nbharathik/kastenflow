// Looking through a deck for the things a check is about: the pictures it names, the pages it points at, the web addresses it embeds. The
// deck is read as JSON, so every kind of element is covered, groups and tables and the theme's own elements included.

import type { Deck } from "@kasten-slides/wasm";

/** Where in the deck something was found: a slide and an element, or the theme (no slide). */
export interface Place {
  slide: string | null;
  element: string | null;
}

/** A path to a picture, and where it is used. */
export interface PictureUse extends Place {
  path: string;
  /** Whether it is the still of an embedded page or a video. */
  poster: boolean;
}

export interface PageUse extends Place {
  path: string;
  /** The heading it points at, if any. */
  section: string | null;
  /** `link` for a link, `source` for a page an element was made from or shows. */
  how: "link" | "source";
}

export interface WebUse extends Place {
  address: string;
  /** `embed` for a live page, `picture` for a picture from the web. */
  kind: "embed" | "picture";
}

const PICTURE_KEYS = new Set(["src", "image", "preview", "poster"]);

/** Whether an address is out on the web (or inline data), not a path in the host's store. */
export const isRemote = (address: string): boolean => /^(?:https?:|data:|\/\/)/i.test(address.trim());

/** The parts of the deck a scan looks through: each slide, then the theme's master and layouts (which no slide owns). */
function parts(deck: Deck): { slide: string | null; value: unknown }[] {
  return [...deck.slides.map((slide) => ({ slide: slide.id as string | null, value: slide })), { slide: null, value: deck.theme }];
}

/** Calls `visit` for every object of the deck with the slide it is on and the element it is inside (the nearest object that has an id and a type). */
function each(deck: Deck, visit: (object: Record<string, unknown>, at: Place) => void): void {
  for (const part of parts(deck)) {
    const walk = (value: unknown, element: string | null): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item, element);
      } else if (value !== null && typeof value === "object") {
        const object = value as Record<string, unknown>;
        const mine = typeof object.type === "string" && typeof object.id === "string" ? object.id : element;
        visit(object, { slide: part.slide, element: mine });
        for (const inner of Object.values(object)) walk(inner, mine);
      }
    };
    walk(part.value, null);
  }
}

/** Every picture the deck names, as the exports ask the host for them: where each is used. A video's file is not a picture; its still is. */
export function picturesOf(deck: Deck): PictureUse[] {
  const found: PictureUse[] = [];
  each(deck, (object, at) => {
    for (const [key, inner] of Object.entries(object)) {
      if (!PICTURE_KEYS.has(key) || typeof inner !== "string" || inner === "") continue;
      if (key === "src" && object.type === "video") continue;
      found.push({ ...at, path: inner, poster: key === "poster" });
    }
  });
  return found;
}

/** Splits `page:<path>#<heading>`; the path is the host's own name for the page, written with `%20` and the like. */
function readPageLink(href: string): { path: string; section: string | null } | null {
  if (!/^page:/i.test(href.trim())) return null;
  const rest = href.trim().slice("page:".length);
  const at = rest.indexOf("#");
  const decode = (text: string): string => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  const path = decode(at < 0 ? rest : rest.slice(0, at)).trim();
  const section = at < 0 ? "" : decode(rest.slice(at + 1)).trim();
  return path === "" ? null : { path, section: section === "" ? null : section };
}

/** The pages of the host the deck points at: its links to pages, and the pages its elements were made from or show. */
export function pagesOf(deck: Deck): PageUse[] {
  const found: PageUse[] = [];
  each(deck, (object, at) => {
    if (typeof object.link === "string") {
      const link = readPageLink(object.link);
      if (link) found.push({ ...at, ...link, how: "link" });
    }
    const source = object.source;
    if (source !== null && typeof source === "object" && typeof (source as { page?: unknown }).page === "string") {
      const page = (source as { page: string; section?: unknown }).page;
      const section = (source as { section?: unknown }).section;
      if (page.trim() !== "") found.push({ ...at, path: page, section: typeof section === "string" && section !== "" ? section : null, how: "source" });
    }
  });
  return found;
}

/** The web addresses the deck embeds, and its pictures that come from the web. */
export function webOf(deck: Deck): WebUse[] {
  const found: WebUse[] = [];
  each(deck, (object, at) => {
    if (object.type === "embed" && typeof object.url === "string" && /^https?:/i.test(object.url.trim())) found.push({ ...at, address: object.url.trim(), kind: "embed" });
  });
  for (const picture of picturesOf(deck)) if (isRemote(picture.path) && /^https?:/i.test(picture.path.trim())) found.push({ slide: picture.slide, element: picture.element, address: picture.path.trim(), kind: "picture" });
  return found;
}
