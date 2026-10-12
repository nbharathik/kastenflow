// Opening the page an element came from or links to: from the editor, a link goes to a peek at the side by default (the host's own Open
// menu offers the other places), so the person keeps their place in the deck.

import type { Element } from "@kasten-slides/wasm";

import type { OpenPageWay, SlidesHost } from "../editor/host.ts";
import { parsePageLink } from "./links.ts";

/** The page an element leads to: the page it was made from or points at, or the page its own link names; null when it has none. */
export function pageOfElement(element: Element | undefined): { path: string; section: string | null } | null {
  if (!element) return null;
  const linked = parsePageLink(element.link);
  if (linked) return linked;
  const source = element.source;
  return source ? { path: source.page, section: source.section ?? null } : null;
}

/** Opens a page by the host's own way; false when the host has none. */
export function openPage(host: SlidesHost, path: string, section: string | null, how: OpenPageWay = "peek"): boolean {
  if (!host.openPage) return false;
  host.openPage(path, how, section);
  return true;
}

/** Opens the page an element leads to. */
export function openElementPage(host: SlidesHost, element: Element, how: OpenPageWay = "peek"): boolean {
  const target = pageOfElement(element);
  return target ? openPage(host, target.path, target.section, how) : false;
}
