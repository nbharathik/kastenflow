// Links to pages of the host (Kasten pages). A deck cannot hold a path of its own as a link, so a link to a page is `page:` and the
// page's path in the host's own naming, with spaces and the marks of a link written as `%20` and the like, then `#` and a heading
// for a section. The engine writes the same form (`pageLink` in the WebAssembly build) for the links it makes from wiki links.

export const PAGE_SCHEME = "page:";

const escape = (part: string): string => part.replace(/[ ()%#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

const unescape = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** Whether an address is a link to a page of the host. */
export function isPageLink(href: string | null | undefined): boolean {
  return typeof href === "string" && href.trim().toLowerCase().startsWith(PAGE_SCHEME);
}

/** The address of a link to the page at `path`, or to the section under a heading of it. */
export function makePageLink(path: string, section?: string | null): string {
  const heading = section?.trim();
  return heading ? `${PAGE_SCHEME}${escape(path.trim())}#${escape(heading)}` : `${PAGE_SCHEME}${escape(path.trim())}`;
}

/** The page and the heading a link names, or null for an address that is not a link to a page (or names no page). */
export function parsePageLink(href: string | null | undefined): { path: string; section: string | null } | null {
  if (!isPageLink(href)) return null;
  const rest = (href as string).trim().slice(PAGE_SCHEME.length);
  const at = rest.indexOf("#");
  const path = unescape(at < 0 ? rest : rest.slice(0, at)).trim();
  const section = at < 0 ? "" : unescape(rest.slice(at + 1)).trim();
  return path === "" ? null : { path, section: section === "" ? null : section };
}
