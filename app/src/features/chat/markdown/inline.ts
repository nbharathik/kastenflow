// Text inside a block: code spans, bold, italic, strikethrough, links, bare
// addresses and [[wiki links]]. Anything that does not close stays as
// typed, so half-streamed marks show as text until their end arrives.
// Links keep only http, https and mailto addresses.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  /** `[[Title]]`, `[[Title#Heading]]`, `[[Title|alias]]` or `![[Title]]`. */
  | { type: "wiki"; title: string; label: string }
  /** `$x^2$`, or `$$x^2$$` written inside a line. */
  | { type: "math"; tex: string; display: boolean }
  | { type: "break" };

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const BARE_URL = /^https?:\/\/[^\s<>"'`]*[^\s<>"'`.,:;!?*_~)\]]/;

/** The address when a link may go there: web and mail only, never `javascript:`. */
export function safeHref(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, "");
  // Browsers ignore control characters and spaces inside a scheme.
  // eslint-disable-next-line no-control-regex -- Strip or reject literal control characters in untrusted text.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[\u0000- ]/g, ""))?.[1]?.toLowerCase();
  return scheme === "http" || scheme === "https" || scheme === "mailto" ? url : null;
}

/** A link's words as plain text. */
export function wordsOf(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.text;
        case "math":
          return node.tex;
        case "wiki":
          return node.label;
        case "break":
          return " ";
        default:
          return wordsOf(node.children);
      }
    })
    .join("");
}

/** Where a link goes, when its words don't say so themselves. An answer can
 * repeat a link from a clipped page whose words name one site while its
 * address is another; the real site then shows beside the words. */
export function unsaidDestination(href: string, children: Inline[]): string | null {
  let where: string;
  let masked: boolean;
  try {
    const url = new URL(href);
    const mail = url.protocol === "mailto:";
    // The site, or the address a mail link writes to.
    where = mail ? decodeURIComponent(url.pathname) : url.host;
    // "https://bank.example@other.example" reads as the bank but goes to the other.
    masked = !mail && (url.username !== "" || url.password !== "");
  } catch {
    return null;
  }
  if (!where) return null;
  return masked || !wordsOf(children).toLowerCase().includes(where.toLowerCase()) ? where : null;
}

/** Where the run of `mark` characters starting at `from` ends. */
function runEnd(src: string, from: number, mark: string): number {
  let end = from;
  while (src[end] === mark) end++;
  return end;
}

/** Where a code span that opened with `size` backticks closes, or -1. */
function codeClose(src: string, from: number, size: number): number {
  for (let at = src.indexOf("`", from); at >= 0; at = src.indexOf("`", at)) {
    const end = runEnd(src, at, "`");
    if (end - at === size) return at;
    at = end;
  }
  return -1;
}

/** Where `delim` closes an emphasis opened just before `from`, or -1. Code
 * spans in between are skipped; a single mark never closes on a double. */
function emphasisClose(src: string, from: number, delim: string): number {
  const mark = delim[0]!;
  for (let at = from; at < src.length; at++) {
    const c = src[at];
    if (c === "\\") {
      at++;
      continue;
    }
    if (c === "`") {
      const end = runEnd(src, at, "`");
      const close = codeClose(src, end, end - at);
      at = close < 0 ? end - 1 : close + (end - at) - 1;
      continue;
    }
    if (c !== mark || at === from) continue;
    const end = runEnd(src, at, mark);
    const size = end - at;
    const fits = delim.length === 2 ? size >= 2 : size === 1 || size === 3;
    const closes = fits && !/\s/.test(src[at - 1]!) && (mark !== "_" || !WORD.test(src[end] ?? ""));
    // A longer run closes with its end: `***both***` is bold around italic.
    if (closes) return end - delim.length;
    at = end - 1;
  }
  return -1;
}

/** `]` matching the `[` at `open`, or -1. */
function bracketClose(src: string, open: number): number {
  let depth = 0;
  for (let at = open; at < src.length; at++) {
    if (src[at] === "\\") at++;
    else if (src[at] === "[") depth++;
    else if (src[at] === "]" && --depth === 0) return at;
    else if (src[at] === "\n" && src[at + 1] === "\n") return -1;
  }
  return -1;
}

/** The `(address "title")` after a link's text: the address and where it ends. */
function destination(src: string, from: number): { url: string; end: number } | null {
  if (src[from] !== "(") return null;
  let depth = 0;
  for (let at = from; at < src.length; at++) {
    const c = src[at];
    if (c === "\\") at++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) {
      const inner = src.slice(from + 1, at).trim();
      const url = /^(<[^>]*>|\S+)/.exec(inner)?.[1] ?? "";
      return { url, end: at + 1 };
    } else if (c === "\n") return null;
  }
  return null;
}

/** Math opened by the `$` at `from`: `$$…$$`, or `$…$` as Pandoc reads it (no space inside the marks, and no digit straight after the closing one, so "$5 and $10" stays two prices). */
function mathAt(src: string, from: number): { tex: string; display: boolean; end: number } | null {
  if (src[from + 1] === "$") {
    const close = src.indexOf("$$", from + 2);
    const tex = close < 0 ? "" : src.slice(from + 2, close).trim();
    return tex ? { tex, display: true, end: close + 2 } : null;
  }
  if (/\s/.test(src[from + 1] ?? " ")) return null;
  for (let at = from + 1; at < src.length; at++) {
    const c = src[at];
    if (c === "\\") at++;
    else if (c === "\n") return null;
    else if (c === "$") return /\s/.test(src[at - 1]!) || /\d/.test(src[at + 1] ?? "") ? null : { tex: src.slice(from + 1, at), display: false, end: at + 1 };
  }
  return null;
}

/** How deep marks and links nest before the rest reads as text. */
const MAX_DEPTH = 32;

export function parseInline(src: string, depth = 0): Inline[] {
  if (depth >= MAX_DEPTH) return src ? [{ type: "text", text: src }] : [];
  // Where the search for each closing mark found none: none is found from
  // further on either, so a paragraph of unmatched marks stays linear.
  const unclosed = new Map<string, number>();
  const closeOf = (from: number, delim: string) => {
    const none = unclosed.get(delim);
    if (none !== undefined && from >= none) return -1;
    const close = emphasisClose(src, from, delim);
    if (close < 0) unclosed.set(delim, Math.min(from, none ?? from));
    return close;
  };
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };

  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const prev = src[i - 1] ?? " ";
    if (c === "\\" && PUNCTUATION.test(src[i + 1] ?? "")) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      push({ type: "break" });
      i++;
      continue;
    }
    if (c === "`") {
      const end = runEnd(src, i, "`");
      const close = codeClose(src, end, end - i);
      if (close < 0) {
        text += src.slice(i, end);
        i = end;
        continue;
      }
      const code = src.slice(end, close).replace(/\n/g, " ");
      push({ type: "code", text: /^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code });
      i = close + (end - i);
      continue;
    }
    if (c === "$") {
      const math = mathAt(src, i);
      if (math) {
        push({ type: "math", tex: math.tex, display: math.display });
        i = math.end;
        continue;
      }
    }
    const wikiAt = src.startsWith("[[", i) ? i : c === "!" && src.startsWith("[[", i + 1) ? i + 1 : -1;
    if (wikiAt >= 0) {
      const close = src.indexOf("]]", wikiAt + 2);
      const inner = close < 0 ? "" : src.slice(wikiAt + 2, close);
      if (inner.trim() && !/[[\]\n]/.test(inner)) {
        const [target = "", alias] = inner.split("|");
        const [title = "", heading] = target.split("#");
        const label = alias?.trim() || (heading?.trim() ? `${title.trim()} › ${heading.trim()}` : title.trim());
        if (title.trim()) {
          push({ type: "wiki", title: title.trim(), label });
          i = close + 2;
          continue;
        }
      }
    }
    if (c === "[" || (c === "!" && src[i + 1] === "[")) {
      const open = c === "!" ? i + 1 : i;
      const close = bracketClose(src, open);
      const dest = close < 0 ? null : destination(src, close + 1);
      if (dest) {
        const label = src.slice(open + 1, close);
        const href = safeHref(dest.url);
        // A picture shows as a link to it: answers load nothing by themselves.
        const children = c === "!" ? [{ type: "text" as const, text: label.trim() || "picture" }] : parseInline(label, depth + 1);
        if (href) push({ type: "link", href, children });
        else {
          flush();
          out.push(...children);
        }
        i = dest.end;
        continue;
      }
    }
    if (c === "<") {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/i.exec(src.slice(i));
      if (auto) {
        push({ type: "link", href: auto[1]!, children: [{ type: "text", text: auto[1]! }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((c === "h" || c === "H") && !WORD.test(prev)) {
      const bare = BARE_URL.exec(src.slice(i));
      if (bare) {
        push({ type: "link", href: bare[0], children: [{ type: "text", text: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }
    if (c === "*" || c === "_" || c === "~") {
      const end = runEnd(src, i, c);
      const size = end - i;
      const delim = c === "~" ? (size === 2 ? "~~" : "") : size >= 2 ? c + c : c;
      const opens = delim !== "" && !/\s/.test(src[i + delim.length] ?? " ") && (c !== "_" || !WORD.test(prev));
      const close = opens ? closeOf(i + delim.length, delim) : -1;
      if (close > i + delim.length) {
        const kind = c === "~" ? "del" : delim.length === 2 ? "strong" : "em";
        push({ type: kind, children: parseInline(src.slice(i + delim.length, close), depth + 1) });
        i = close + delim.length;
        continue;
      }
      text += src.slice(i, end);
      i = end;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}
