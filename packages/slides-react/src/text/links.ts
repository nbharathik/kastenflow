// Which addresses a link may have. A slide's text can come from anywhere (a
// pasted page, an imported file, an agent), and whoever presents the slide
// follows its links, so only ordinary addresses and links to slides and to pages of the host are kept.

const SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "slide:", "page:"]);

/** The address if it is an ordinary one (web, mail, phone, or a slide); null for anything else, such as `javascript:`. */
export function safeLink(href: string | null | undefined): string | null {
  const address = (href ?? "").trim();
  if (address === "" || /\p{Cc}/u.test(address)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(address)?.[1];
  return scheme !== undefined && SCHEMES.has(`${scheme.toLowerCase()}:`) ? address : null;
}

/**
 * What a person typed as an address, made into a link address: an ordinary
 * address as it is, and a bare `example.com/page` as a web address. Null for
 * nothing, or for an address that must not be followed.
 */
export function linkFromInput(input: string | null | undefined): string | null {
  const address = (input ?? "").trim();
  if (address === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(address)) return safeLink(address);
  return /^[^\s/?#]+\.[^\s/?#]+/.test(address) || /^localhost(:\d+)?([/?#]|$)/.test(address) ? safeLink(`https://${address}`) : null;
}
