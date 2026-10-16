// Web links in the desktop app open in the system's browser (or, when
// Settings says so and the browser is on, in a Kasten browser tab to the
// right; Shift+click uses the other): the app's window opens no other page, so
// a link card, a chat's link or a URL property would otherwise do nothing. In
// text being written, as in any editor, a click places the caret and Ctrl or
// Cmd with it follows the link.

import { useEffect } from "react";

import { inTauri, openUrl } from "../lib/api";
import { isKastenLink } from "../lib/kasten-links";
import { windowCovered } from "../features/browser/cover";
import { useBrowserPrefs } from "../features/browser/prefs";
import { howFrom, useWorkspace, type OpenHow } from "../features/workspace/store";

const WEB = /^(https?:\/\/|mailto:)/i;

/** Opens the web link a click is on with `open`, and keeps the window
 * from trying to. The app's own `#` links, and clicks already handled, are
 * left alone; any other link (a file, a relative path, a script) goes
 * nowhere, since the window must never leave the app's page. */
export function followWebLink(event: MouseEvent, open: (url: string) => void): void {
  if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
  const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
  const href = anchor?.getAttribute("href")?.trim();
  if (!anchor || href === undefined || href.startsWith("#")) return;
  event.preventDefault();
  if (!WEB.test(href)) return;
  const editing = anchor.closest('[contenteditable]:not([contenteditable="false"])');
  if (editing && !(event.ctrlKey || event.metaKey)) return;
  open(href);
}

/** Opens a web link where Settings says (Browser: the system's browser, or a
 * Kasten browser tab to the right); `other` (Shift) uses the other one. A tab
 * needs the browser turned on, and only web pages go there, never a mail link.
 * Never a tab while a view that fills the window is open (a presentation): the
 * tab would be out of sight beneath it. */
export function openWeb(url: string, other = false): void {
  const { webLinks, enabled } = useBrowserPrefs.getState();
  const tab = (webLinks === "tab") !== other;
  if (tab && enabled && !windowCovered() && /^https?:\/\//i.test(url)) {
    void import("../features/browser/open").then((m) => m.openInBrowserTab(url));
    return;
  }
  openUrl(url).catch((err: unknown) => useWorkspace.getState().toast(err instanceof Error ? err.message : String(err)));
}

/** Opens the `kasten:` link a click is on (a place in the vault, found by
 * id, so it survives a rename) with `open`, and keeps the window from trying
 * to. In text being written a click places the caret, and Ctrl or Cmd with it
 * follows the link, as for web links. Other links are left alone. */
export function followKastenLink(event: MouseEvent, open: (href: string, how: OpenHow) => void): void {
  if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
  const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
  const href = anchor?.getAttribute("href")?.trim();
  if (!anchor || !href || !isKastenLink(href)) return;
  event.preventDefault();
  const editing = anchor.closest('[contenteditable]:not([contenteditable="false"])');
  if (editing && !(event.ctrlKey || event.metaKey)) return;
  open(href, howFrom(event));
}

export function useWebLinks(): void {
  useEffect(() => {
    // `kasten:` links work wherever the app does, a plain browser included.
    const kasten = (event: MouseEvent) => followKastenLink(event, (href, how) => void import("../features/workspace/open-kasten-link").then((m) => m.openKastenLink(href, how)));
    document.addEventListener("click", kasten);
    document.addEventListener("auxclick", kasten);
    const removeKasten = () => {
      document.removeEventListener("click", kasten);
      document.removeEventListener("auxclick", kasten);
    };
    if (!inTauri()) return removeKasten;
    const follow = (event: MouseEvent) => followWebLink(event, (url) => openWeb(url, event.shiftKey));
    document.addEventListener("click", follow);
    document.addEventListener("auxclick", follow);
    return () => {
      removeKasten();
      document.removeEventListener("click", follow);
      document.removeEventListener("auxclick", follow);
    };
  }, []);
}
