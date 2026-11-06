// Which addresses an embedded page may be loaded from. A deck is a file that comes from anywhere, and a presentation
// runs its embeds for real, so only web addresses go in a frame: never a script, a local file or a page made of data.

import { type EmbedLink, type PlaybackOptions, playbackUrl, toEmbedUrl } from "../embed/embed-url.ts";

/**
 * Whether a host is one the app a deck is shown in serves its own pages from, or is written to look like one: any `*.localhost` (the
 * app is `tauri.localhost` on Windows, its diagram editor `diagrams.localhost`, its commands `ipc.localhost`), and a name with a
 * trailing dot, which the network treats as the same host and a comparison of origins as another.
 */
function appHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith(".") || host.endsWith(".localhost");
}

/** The web address a frame may load for this text, or null when it is anything else, or a page of the app itself. */
export function embedUrl(address: string | null | undefined): string | null {
  const text = (address ?? "").trim();
  if (text === "") return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return appHost(url.hostname) ? null : url.href;
  } catch {
    return null;
  }
}

/**
 * What the frame is allowed: scripts and its own storage, a popup (the player's "Watch on YouTube" link, which the app opens in the
 * system's browser and never in a window of its own) and the player's full-screen presentation. Still no forms, top navigation,
 * downloads or pointer lock.
 */
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";

/** What a frame may ask of the browser: the features a video player needs. */
export const EMBED_ALLOW = "autoplay; fullscreen; encrypted-media; picture-in-picture";

/** Only the origin of the page around a frame is told which page the visitor came from: a player that wants to know it is embedded there asks for no more. */
export const EMBED_REFERRER = "strict-origin-when-cross-origin";

/**
 * What the frame for a page is allowed. A page from the origin of the page that shows it is not given its own storage: with scripts
 * and that, it could take its sandbox off and reach the page around it.
 */
export function embedSandbox(address: string, here: string | undefined = typeof location === "object" ? location.origin : undefined): string {
  try {
    return new URL(address).origin === here ? "allow-scripts" : EMBED_SANDBOX;
  } catch {
    return "allow-scripts";
  }
}

/** The fields of an embed that say how its video plays. */
export interface EmbedFields extends PlaybackOptions {
  url: string;
}

/**
 * What a frame loads for an embed: the address the person gave, turned into the site's own embed (a YouTube watch link becomes its player)
 * with the start, end and playback options of the element. Null when the address is not a web address.
 */
export function frameAddress(element: EmbedFields): { url: string; link: EmbedLink } | null {
  const link = toEmbedUrl(element.url);
  if (link === null) return null;
  const url = embedUrl(playbackUrl(link, element));
  return url === null ? null : { url, link };
}
