// Following a link of a slide: to another slide, to a page of the host, or out to the web. Where the link goes depends on where it was
// followed (the editor opens a page in a peek at the side, a presentation in a calm panel over the slide), so the places are handed in.

import { safeLink } from "../text/links.ts";
import { parsePageLink } from "./links.ts";

/** What can be done with a link, where it was followed. Anything left out is a link that does nothing here. */
export interface LinkWays {
  /** Goes to the slide with this id. */
  slide?: (id: string) => void;
  /** Opens a page of the host, at a heading when the link names one. */
  page?: (path: string, section: string | null) => void;
  /** Opens a web address (or mail, or phone) outside the slide. */
  web?: (address: string) => void;
}

/** What a link is, by its address. */
export type LinkKind = "slide" | "page" | "web";

/** The kind of a link, or null for an address that must not be followed (a script, a file, a made-up scheme). */
export function kindOfLink(href: string | null | undefined): LinkKind | null {
  const address = safeLink(href);
  if (address === null) return null;
  if (/^slide:/i.test(address)) return "slide";
  if (parsePageLink(address) !== null) return "page";
  return /^page:/i.test(address) ? null : "web";
}

/** Follows a link by the ways given; answers whether it went anywhere. */
export function followLink(href: string | null | undefined, ways: LinkWays): boolean {
  const kind = kindOfLink(href);
  const address = safeLink(href);
  if (kind === null || address === null) return false;
  if (kind === "slide") {
    const id = address.slice("slide:".length).trim();
    if (!id || !ways.slide) return false;
    ways.slide(id);
    return true;
  }
  if (kind === "page") {
    const page = parsePageLink(address);
    if (!page || !ways.page) return false;
    ways.page(page.path, page.section);
    return true;
  }
  if (!ways.web) return false;
  ways.web(address);
  return true;
}

/** What a page's path is called by: its file's name without the extension. */
export const nameOfPath = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** Where a link goes, in words, for a hover: the page and heading, the web address, or the slide. */
export function linkHint(href: string | null | undefined): string {
  const kind = kindOfLink(href);
  if (kind === "slide") return "Go to that slide";
  if (kind === "page") {
    const page = parsePageLink(href);
    return page ? `Open the page ${nameOfPath(page.path)}${page.section ? `, at ${page.section}` : ""}` : "";
  }
  return kind === "web" ? (safeLink(href) ?? "") : "";
}

/** How a web address is opened when the host has no way of its own: a new window with nothing shared with the slide. */
export function openInWindow(address: string): void {
  window.open(address, "_blank", "noopener,noreferrer");
}

/** The link under an event's target, at or above it: a run of text with an address, or an element that links. */
export function linkAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest<HTMLElement>("[data-href], [data-link]");
  return node?.getAttribute("data-href") ?? node?.getAttribute("data-link") ?? null;
}
