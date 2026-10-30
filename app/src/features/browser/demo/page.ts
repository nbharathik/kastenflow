// The one page the demo's browser shows, whatever the address: a calm essay
// page with the address in its header. Nothing is fetched from the web.

import canned from "./canned.html?raw";

/** What a page is called and where it says it is. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "") || "example.org";
  } catch {
    return "example.org";
  }
}

export const titleOf = (url: string): string => `Notes that outlast the app · ${hostOf(url)}`;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page for `url`, as the document the frame shows. */
export function pageFor(url: string): string {
  return canned
    .replace("{{title}}", () => escape(titleOf(url)))
    .replace("{{host}}", () => escape(hostOf(url)))
    .replace("{{url}}", () => escape(url));
}
