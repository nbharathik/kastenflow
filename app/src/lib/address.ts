// Web addresses in captured text: what counts as one, the absolute address
// for a link, and the name of its site.

/** A pasted web address on its own: with its scheme, or starting with `www.`. */
export function isAddress(text: string): boolean {
  const t = text.trim();
  return !/\s/.test(t) && (/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(t) || /^www\.[^/\s]+\.[a-z]{2,}/i.test(t));
}

/** The address with its scheme, for a link: `www.example.org/a` is `https://www.example.org/a`. */
export function absoluteAddress(text: string): string {
  const t = text.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** The site's name in a link when the page has no title to read: the host without `www.`. */
export function hostName(address: string): string {
  try {
    return new URL(absoluteAddress(address)).hostname.replace(/^www\./i, "") || address.trim();
  } catch {
    return address.trim();
  }
}

/** `[Title](address)` for an address, a bracket in the title kept from ending it. */
export function markdownLink(title: string, address: string): string {
  const text = title.replace(/\s+/g, " ").trim().replace(/[[\]\\]/g, "\\$&") || hostName(address);
  return `[${text}](${absoluteAddress(address).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20")})`;
}
