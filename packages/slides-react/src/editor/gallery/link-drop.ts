// A link dragged onto the slide (from a browser's address bar, a page, a bookmark): it becomes an embed where it is let go, as a pasted one
// does. Only a single web address is taken; dragged words and anything else are left to the slide's other drops.

import type { DragEvent } from "react";

import { singleLinkOf } from "../../embed/embed-url.ts";

type Transfer = Pick<DragEvent, "dataTransfer">;

/**
 * Whether a link is being dragged (known while it is over the slide: the address itself is read only when dropped). A browser drags a link
 * as a `text/uri-list`; dragged words, which only have `text/plain`, are not taken.
 */
export function hasLinkDrag(event: Transfer): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("text/uri-list");
}

/** The web address dropped, once it is dropped: the first of a `text/uri-list` (lines that begin with # are its comments), else a text that is only an address. */
export function droppedLink(event: Transfer): string | null {
  const data = event.dataTransfer;
  if (!data) return null;
  const listed = (data.getData("text/uri-list") || "").split(/\r?\n/).find((line) => line.trim() !== "" && !line.startsWith("#"));
  return singleLinkOf(listed) ?? singleLinkOf(data.getData("text/plain"));
}
