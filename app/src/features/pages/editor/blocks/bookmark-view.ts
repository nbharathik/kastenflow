// A bookmark: a paragraph whose only content is one web link with a title of
// its own (`[Title](https://…)`), drawn as a card with the title and the site.
// It is only the look of that paragraph (a decoration, found in the same pass
// as the other links alone on their line, alone.ts): nothing is fetched to
// draw it, and the Markdown stays the link. The card gives way to the link as
// written while the caret is in it.

import "./bookmark.css";

import type { Node } from "@milkdown/kit/prose/model";
import { Decoration } from "@milkdown/kit/prose/view";

export interface Bookmark {
  /** The site, without `www.`. */
  domain: string;
}

/** The card for a link with this text and address, or null when the text is
 * the address, or the address is not a web page. */
export function bookmarkOf(text: string, href: string): Bookmark | null {
  const address = href.trim();
  if (!text.trim() || text.trim() === address || !/^https?:\/\/[^\s/?#]+/i.test(address)) return null;
  try {
    const domain = new URL(address).hostname.replace(/^www\./i, "");
    return domain ? { domain } : null;
  } catch {
    return null;
  }
}

/** What marks a decoration as a bookmark card. */
export const isBookmark = (spec: unknown): boolean => (spec as { bookmark?: boolean } | null)?.bookmark === true;

/** The card decoration for `paragraph` (at `pos`), when its only content is one titled web link. */
export function bookmarkDecoration(paragraph: Node, pos: number): Decoration | null {
  const only = paragraph.childCount === 1 ? paragraph.firstChild! : null;
  const link = only?.isText ? only.marks.find((mark) => mark.type.name === "link") : undefined;
  const card = only && link && bookmarkOf(only.text ?? "", String(link.attrs.href ?? ""));
  if (!card) return null;
  return Decoration.node(pos, pos + paragraph.nodeSize, { class: "kasten-bookmark", "data-domain": card.domain }, { bookmark: true });
}
