// Pages of the host (Kasten pages) as the engine reads them. The host gives the Markdown of a page; these tell what is in it, so a view
// can draw an embedded page and a host can list the sections of one. Nothing is read from anywhere: Markdown in, blocks out.

import { pageBlocks as blocksOf, pageBody as bodyOf, pageFingerprint as fingerprintOf, pageLink as linkOf, pageSection as sectionOf, pageSections as sectionsOf } from "../pkg/slides_wasm.js";
import type { Block, PageSection } from "./generated/index.ts";

/** How many pages' blocks are kept, the ones asked for longest ago going first: a page drawn again is not read again. */
const MOST_KEPT = 24;
const kept = new Map<string, readonly Block[]>();

/** The blocks of a page's Markdown: headings, paragraphs, list items, quotes, code, formulas, pictures, tables and rules. Frontmatter is left off. */
export function pageBlocks(markdown: string): readonly Block[] {
  const hit = kept.get(markdown);
  if (hit) {
    kept.delete(markdown);
    kept.set(markdown, hit);
    return hit;
  }
  const made = JSON.parse(blocksOf(markdown)) as Block[];
  kept.set(markdown, made);
  if (kept.size > MOST_KEPT) kept.delete(kept.keys().next().value as string);
  return made;
}

/** The headings of a page, each with the lines it runs over. */
export function pageSections(markdown: string): PageSection[] {
  return JSON.parse(sectionsOf(markdown)) as PageSection[];
}

/** The Markdown of the section under `heading` (found without regard to case), or null when the page has none. */
export function pageSection(markdown: string, heading: string): string | null {
  return sectionOf(markdown, heading) ?? null;
}

/** What tells whether a page's words changed: the same for the same words, however the lines end. */
export const pageFingerprint = (markdown: string): string => fingerprintOf(markdown);

/** The page's Markdown without the frontmatter block at its top. */
export const pageBody = (markdown: string): string => bodyOf(markdown);

/** The address of a link to a page of the host: `page:` and its path, then `#` and the heading for a section. */
export const pageLink = (path: string, section?: string | null): string => linkOf(path, section ?? undefined);
