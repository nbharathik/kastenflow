// Where a smart page's frame is loaded from: the app's `smart` scheme, at
// `smart://localhost/<frame>/<page id>/<file>` or, where a web view knows only
// http and https (Windows), `http://smart.localhost/<frame>/<page id>/<file>`.
// `<frame>` is a secret the app made for this one frame (`smart_frame_open`);
// the app serves nothing for a secret it does not know, so a page's code, which
// sees only its own address, can neither load another page's files nor send its
// frame to another page. The page id and each part of the file's path are
// encoded on their own, so a slash in a name can never become a second part.

import { convertFileSrc } from "@tauri-apps/api/core";

/** The scheme's address without a trailing slash. */
export function frameBase(): string {
  try {
    return convertFileSrc("", "smart").replace(/\/+$/, "");
  } catch {
    // No desktop app behind this window (the preview, a test): the form this system would use.
    return typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent) ? "http://smart.localhost" : "smart://localhost";
  }
}

const parts = (path: string) =>
  path
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

/** The address of a file of the page's folder, for the frame with the secret `frame` (the page's `index.html` unless another is named). */
export function frameUrl(frame: string, pageId: string, file = "index.html"): string {
  return `${frameBase()}/${encodeURIComponent(frame)}/${encodeURIComponent(pageId)}/${parts(file)}`;
}
