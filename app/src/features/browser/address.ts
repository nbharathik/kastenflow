// What the address box makes of what was typed: an address to go to, or words
// to search for with the chosen engine. Pure, and checked again by the app,
// which opens web pages and nothing else.

import type { Engine } from "./prefs";

export type Interpreted = { url: string } | { error: string };

/** A scheme the browser does not open. */
const NOT_WEB = /^(?:about|javascript|data|file|mailto|blob|view-source|chrome|edge|tauri|ipc|asset|diagrams|ftp):/i;
const LOCAL = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+\.local)(?::\d{1,5})?(?:[/?#].*)?$/i;
/** `host.tld`, with a port and a path if given; no spaces. */
const HOSTLIKE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

export function interpret(input: string, engine: Engine): Interpreted {
  const text = input.trim();
  if (!text) return { error: "Type an address, or something to search for" };
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return url.username || url.password ? { error: "An address with a name and password is not opened" } : { url: url.toString() };
    } catch {
      return { error: `“${text}” is not a web address` };
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || NOT_WEB.test(text)) return { error: "The browser opens web pages only" };
  if (!/\s/.test(text)) {
    if (LOCAL.test(text)) return { url: `http://${text}` };
    if (HOSTLIKE.test(text)) return { url: `https://${text}` };
  }
  return { url: engine.url.replace("%s", encodeURIComponent(text)) };
}

/** What a tab shows in its place for an address: the site's name. */
export function siteOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}
