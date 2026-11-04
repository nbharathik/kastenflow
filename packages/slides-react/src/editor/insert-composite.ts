// Putting something new on the shown slide: where it goes, and the one
// operation that adds it. A menu, the insert palette and a dialog all come here.

import type { Element } from "@kasten-slides/wasm";

import { toEmbedUrl } from "../embed/embed-url.ts";
import { type CompositeKind, type Source, compositeSpec, embedSize, newComposite } from "./composite-kinds.ts";
import { addEmbedPoster } from "./embed-poster.ts";
import { type Corner, boxFor, masterBoxes, occupiedBy } from "./placement.ts";
import type { EditorSession } from "./session/session.ts";
import type { Box } from "./session/types.ts";

/** Where on the shown slide an element of this size goes: the middle of the largest place nothing is in, or the `corner` if it is free. */
export function freeBox(session: EditorSession, size: { w: number; h: number }, corner?: Corner): Box {
  const { deck } = session;
  const { layout, elements } = session.slide;
  return boxFor(size, [...occupiedBy(deck.theme, layout, elements, deck.size), ...masterBoxes(deck.theme, layout, deck.size)], deck.size, corner);
}

/**
 * Adds an element to the shown slide, on top, in the largest free place, at the
 * size given (shrunk if the place is small). It is selected afterwards, and the
 * whole is one step of undo. Resolves to its id.
 */
export function insertPlaced(session: EditorSession, element: Element, size: { w: number; h: number }, corner?: Corner, at?: { x: number; y: number }): string | undefined {
  return session.elements.insert([{ ...element, ...(at ? centredAt(session, size, at) : freeBox(session, size, corner)) } as Element])[0];
}

/** A box of this size with its middle at a point of the slide (where the pointer was), kept on the slide. */
function centredAt(session: EditorSession, size: { w: number; h: number }, at: { x: number; y: number }): Box {
  const { w, h } = session.deck.size;
  const width = Math.min(size.w, w);
  const height = Math.min(size.h, h);
  return { x: Math.round(Math.min(Math.max(at.x - width / 2, 0), w - width)), y: Math.round(Math.min(Math.max(at.y - height / 2, 0), h - height)), w: width, h: height };
}

/**
 * Adds a new composite of a kind, with something in it to look at and change. `source` is the address a page or a video is made from.
 * A link to a video site (YouTube, Vimeo, Loom) is an embed whichever way it came, even from the video dialog, in a 16:9 box, and a
 * YouTube or Vimeo one gets its thumbnail as its poster once the host has fetched it.
 */
export function insertComposite(session: EditorSession, kind: CompositeKind, source?: Source, at?: { x: number; y: number }): string | undefined {
  const link = (kind === "embed" || kind === "video") && source?.address ? toEmbedUrl(source.address) : null;
  if (kind === "embed" || (kind === "video" && link?.kind === "video")) {
    const id = insertPlaced(session, newComposite("embed", source), embedSize(false, link?.kind === "video"), undefined, at);
    if (id !== undefined && source?.address && link?.kind === "video") void addEmbedPoster(session, id, source.address);
    return id;
  }
  const spec = compositeSpec(kind);
  return insertPlaced(session, newComposite(kind, source), spec.size, spec.corner, at);
}
