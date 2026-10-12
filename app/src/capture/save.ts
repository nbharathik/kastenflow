// Saving a capture where it was aimed. A web address alone is clipped to
// the Inbox (the page's article becomes the card), or kept as a plain card
// when the page will not come; sent to a page or the journal it goes in as a
// link, `[Title](address)`, with the page's own title if it can be read in a
// moment and the site's name if not. Everything goes through the same core
// commands as the main window.

import { absoluteAddress, hostName, isAddress, markdownLink } from "../lib/address";
import { webTitle } from "../lib/api";
import { dayFrom } from "../lib/dates";
import type { VaultClient } from "../lib/vault/types";
import { firstLine, placeName, type Target } from "./targets";

export interface Captured {
  path: string;
  title: string;
  /** Where it went, in words. */
  place: string;
}

/** How long a page's title is waited for before the site's name does. */
const TITLE_WAIT_MS = 4000;

/** The link for a pasted address: its page's title, else the site's name. */
async function linkFor(address: string): Promise<string> {
  const read = webTitle(absoluteAddress(address)).catch(() => null);
  const wait = new Promise<null>((resolve) => setTimeout(() => resolve(null), TITLE_WAIT_MS));
  const title = await Promise.race([read, wait]);
  return markdownLink(title ?? hostName(address), address);
}

/** Keeps `markdown` at `target`; throws what the core says when it cannot. */
export async function saveCapture(client: VaultClient, target: Target, markdown: string): Promise<Captured> {
  const address = isAddress(markdown);
  if (target.kind === "inbox" && address) {
    try {
      const clipped = await client.clipUrl(markdown.trim());
      return { path: clipped.meta.path, title: clipped.meta.title || hostName(markdown), place: placeName(target) };
    } catch {
      // The page would not come (offline, refused, not a page): the link is kept as it was typed.
    }
  }
  if (target.kind === "journal" || target.kind === "page") {
    const text = address ? await linkFor(markdown) : markdown;
    const path = target.kind === "page" ? target.path : (await client.journal(dayFrom(0))).meta.path;
    const note = await client.append(path, text);
    return { path: note.meta.path, title: note.meta.title || placeName(target), place: placeName(target) };
  }
  const note = await client.capture(markdown, [], target.kind === "project" ? target.slug : null);
  return { path: note.meta.path, title: note.meta.title || firstLine(markdown), place: placeName(target) };
}
