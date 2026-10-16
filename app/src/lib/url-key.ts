// A key that is the same for every way of writing the address of one web page,
// so a page saved twice is found. The window's copy of kasten-core's
// `clip::url_key` (the browser preview uses it; inside the app the core does):
// the scheme is left out (http and https are one page), the host is lowercase
// without a leading `www.` or a default port, the fragment and a trailing
// slash (but the root's) go, tracking parameters (`utm_*`, `fbclid`, `gclid`,
// `mc_cid`, `mc_eid`) go and the others are sorted. The path keeps its case.

const TRACKING = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);
const isTracking = (name: string) => {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING.has(lower);
};

/** The key of a web address, or null for what is not one, holds spaces, a name and password, or no site. */
export function urlKey(address: string): string | null {
  const url = address.trim();
  // eslint-disable-next-line no-control-regex -- control characters are never part of an address
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(url)) return null;
  const split = url.indexOf("://");
  if (split < 0) return null;
  const scheme = url.slice(0, split).toLowerCase();
  const defaultPort = scheme === "https" ? "443" : scheme === "http" ? "80" : null;
  if (defaultPort === null) return null;
  const rest = url.slice(split + 3).split("#")[0]!;
  const end = rest.search(/[/?]/);
  const authority = (end < 0 ? rest : rest.slice(0, end)).toLowerCase();
  const tail = end < 0 ? "" : rest.slice(end);
  if (authority.includes("@")) return null;
  let host: string;
  let port: string;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 0) return null;
    host = authority.slice(0, close + 1);
    port = authority.slice(close + 1).replace(/^:/, "");
  } else {
    const colon = authority.indexOf(":");
    host = colon < 0 ? authority : authority.slice(0, colon);
    port = colon < 0 ? "" : authority.slice(colon + 1);
  }
  if (host.startsWith("www.")) host = host.slice(4);
  if (host === "" || host === "[]") return null;
  if (port === defaultPort) port = "";
  const mark = tail.indexOf("?");
  const path = (mark < 0 ? tail : tail.slice(0, mark)).replace(/\/+$/, "");
  const query = mark < 0 ? "" : tail.slice(mark + 1);
  const params = query
    .split("&")
    .filter((p) => p !== "" && !isTracking(p.split("=")[0]!))
    .sort();
  return `${host}${port ? `:${port}` : ""}${path === "" ? "/" : path}${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

/** The address a note keeps in a `url:` line at the top level of its frontmatter (plain, single- or double-quoted), if any. */
export function frontUrl(text: string): string | null {
  // A byte-order mark at the very start is not part of the first line.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return null;
  for (const line of lines.slice(1)) {
    if (line.trimEnd() === "---") break;
    const match = /^url[ \t]*:(.*)$/.exec(line);
    if (!match) continue;
    const value = match[1]!.trim();
    if (value === "" || /^[>|#]/.test(value)) return null;
    if (value.startsWith('"')) {
      const close = value.lastIndexOf('"');
      return close > 0 ? value.slice(1, close).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
    }
    if (value.startsWith("'")) {
      const close = value.lastIndexOf("'");
      return close > 0 ? value.slice(1, close).replace(/''/g, "'") : null;
    }
    return value.split(" #")[0]!.trimEnd() || null;
  }
  return null;
}
