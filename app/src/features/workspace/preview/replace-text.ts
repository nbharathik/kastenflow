// The core's find and replace (replace.rs) on the Markdown of a page as it
// is written, for the browser preview. A match never reaches into what must
// stay as it is: the target of a `[[link]]` with its alias, a link's
// `(address)`, `<autolinks>` and HTML tags, web addresses, reference
// definitions and comments. Text between tags and callout titles are
// matched. A replacement is escaped for Markdown in prose and for HTML
// between tags, and written as it is inside code.

import type { FindSpec, MatchSample } from "../../../lib/vault/types";

type Ctx = "prose" | "html" | "inline" | "block";

/** A match in the body, and how the text there is written. */
export interface Found {
  start: number;
  end: number;
  /** Line of the body, from 0, and where it starts. */
  line: number;
  lineStart: number;
  ctx: Ctx;
}

const BLOCK_TAGS = new Set(
  "address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul".split(" "),
);

type Range = [number, number];
interface State {
  fence: [string, number] | null;
  math: boolean;
  comment: boolean;
  html: boolean;
}

// -- What may be matched ---------------------------------------------------

function fenceMarker(line: string): [string, number] | null {
  const t = line.trimStart();
  if (line.length - t.length > 3) return null;
  const c = t[0];
  if (c !== "`" && c !== "~") return null;
  let n = 0;
  while (t[n] === c) n++;
  return n >= 3 ? [c, n] : null;
}

/** A fence opener or closer moves the open fence; the second answer says the line was one. */
function fenceAfter(fence: State["fence"], line: string): [State["fence"], boolean] {
  const marker = fenceMarker(line);
  if (!marker) return [fence, false];
  if (!fence) return [marker, true];
  const closes = fence[0] === marker[0] && marker[1] >= fence[1] && line.trim().length === marker[1];
  return [closes ? null : fence, true];
}

function startsBlockTag(line: string): boolean {
  const found = /^ *<\/?([A-Za-z0-9]*)/.exec(line);
  if (!found) return false;
  const next = line.charAt(found[0].length);
  return BLOCK_TAGS.has((found[1] ?? "").toLowerCase()) && (next === "" || /\s/.test(next) || next === ">" || next === "/");
}

function isDefinition(line: string): boolean {
  const found = /^ *\[([^\]]+)\]:/.exec(line);
  return Boolean(found) && !found![1]!.startsWith("^") && !found![1]!.includes("[");
}

/** Code spans of a line: the whole span with its backticks, and what is between them. */
function codeSpans(line: string): { full: Range; content: Range }[] {
  const out: { full: Range; content: Range }[] = [];
  const run = (from: number) => {
    let n = 0;
    while (line[from + n] === "`") n++;
    return n;
  };
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") i += 2;
    else if (line[i] === "`") {
      const start = i;
      const n = run(i);
      i += n;
      let j = i;
      let close = -1;
      while (j < line.length) {
        if (line[j] === "`") {
          const m = run(j);
          if (m === n) {
            close = j;
            break;
          }
          j += m;
        } else j++;
      }
      if (close >= 0) {
        out.push({ full: [start, close + n], content: [i, close] });
        i = close + n;
      }
    } else i++;
  }
  return out;
}

function parenEnd(line: string, from: number): number {
  let depth = 1;
  let quote = "";
  for (let i = from; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "\\") i++;
    else if ((c === '"' || c === "'") && i > from && /\s/.test(line[i - 1]!)) quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

function tagEnd(line: string, from: number): number {
  let quote = "";
  for (let i = from; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}

/** What a find must leave alone in a line whose code spans are blanked. */
function protectedRanges(line: string, state: State): Range[] {
  const out: Range[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "\\") i += 2;
    else if (c === "[" && line[i + 1] === "[") {
      const close = line.indexOf("]]", i + 2);
      const inner = close < 0 ? "" : line.slice(i + 2, close);
      if (close >= 0 && inner !== "" && !inner.includes("[")) {
        out.push([line[i - 1] === "!" ? i - 1 : i, close + 2]);
        i = close + 2;
      } else i++;
    } else if (c === "]" && line[i + 1] === "(") {
      const end = parenEnd(line, i + 2);
      if (end >= 0) {
        out.push([i, end + 1]);
        i = end + 1;
      } else i++;
    } else if (c === "]" && line[i + 1] === "[") {
      const end = line.indexOf("]", i + 2);
      if (end >= 0) {
        out.push([i, end + 1]);
        i = end + 1;
      } else i++;
    } else if (c === "<" && line.startsWith("<!--", i)) {
      const end = line.indexOf("-->", i + 4);
      if (end >= 0) {
        out.push([i, end + 3]);
        i = end + 3;
      } else {
        out.push([i, line.length]);
        state.comment = true;
        i = line.length;
      }
    } else if (c === "<" && /[A-Za-z/!?]/.test(line[i + 1] ?? "")) {
      const end = tagEnd(line, i + 1);
      if (end >= 0) {
        out.push([i, end + 1]);
        i = end + 1;
      } else i++;
    } else if (c === "h" && /^https?:\/\//.test(line.slice(i, i + 8)) && (i === 0 || !/[A-Za-z0-9]/.test(line[i - 1]!))) {
      let end = i;
      while (end < line.length && !/[\s<>]/.test(line[end]!)) end++;
      while (end > i && ".,;:!?'\"".includes(line[end - 1]!)) end--;
      out.push([i, end]);
      i = Math.max(end, i + 1);
    } else i++;
  }
  return out;
}

/** The stretches of 0..length outside the blocked ones, which may overlap. */
function gaps(length: number, blocked: Range[]): Range[] {
  const out: Range[] = [];
  let at = 0;
  for (const [from, to] of [...blocked].sort((a, b) => a[0] - b[0])) {
    if (from > at) out.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < length) out.push([at, length]);
  return out;
}

interface Region {
  range: Range;
  ctx: Ctx;
}

const whole = (line: string, ctx: Ctx): Region[] => (line ? [{ range: [0, line.length], ctx }] : []);

function regionsOf(line: string, state: State): Region[] {
  const [fence, marker] = fenceAfter(state.fence, line);
  state.fence = fence;
  if (marker) return [];
  if (state.fence) return whole(line, "block");
  const trimmed = line.trim();
  const mathLine = state.math || trimmed.startsWith("$$");
  if (trimmed === "$$") {
    state.math = !state.math;
    return [];
  }
  if (trimmed.startsWith("$$") && !(trimmed.length > 2 && trimmed.endsWith("$$"))) state.math = true;
  else if (state.math && trimmed.endsWith("$$")) state.math = false;
  if (mathLine) return whole(line, "block");
  const blocked: Range[] = [];
  if (state.comment) {
    const end = line.indexOf("-->");
    if (end < 0) return [];
    blocked.push([0, end + 3]);
    state.comment = false;
  }
  if (trimmed === "") {
    state.html = false;
    return [];
  }
  if (!state.html && startsBlockTag(line)) state.html = true;
  if (!state.html && isDefinition(line)) return [];
  const spans = state.html ? [] : codeSpans(line);
  let masked = line;
  for (const { full } of spans) masked = masked.slice(0, full[0]) + " ".repeat(full[1] - full[0]) + masked.slice(full[1]);
  blocked.push(...protectedRanges(masked, state));
  const code: Range[] = [];
  for (const { full, content } of spans) {
    // A span inside a protected stretch is part of it; any other is code, matched apart from its backticks.
    const inside = blocked.some(([from, to]) => from < full[1] && full[0] < to);
    blocked.push(full);
    if (!inside && content[1] > content[0]) code.push(content);
  }
  const text: Ctx = state.html ? "html" : "prose";
  const out: Region[] = [...gaps(line.length, blocked).map((range): Region => ({ range, ctx: text })), ...code.map((range): Region => ({ range, ctx: "inline" }))];
  return out.sort((a, b) => a.range[0] - b.range[0]);
}

// -- Matching ---------------------------------------------------------------

const WORD = /^[\p{L}\p{N}_\p{M}‍]$/u;
const fold = (c: string): string => {
  const lower = c.toLowerCase();
  return Array.from(lower).length === 1 ? lower : c;
};
const charBefore = (text: string, at: number): string => (at <= 0 ? "" : (Array.from(text.slice(Math.max(0, at - 2), at)).pop() ?? ""));
const charAt = (text: string, at: number): string => (at >= text.length ? "" : String.fromCodePoint(text.codePointAt(at)!));

/** Matches inside `line[from, to)`; a word boundary looks at the whole line. */
function findAll(line: string, [from, to]: Range, spec: FindSpec): Range[] {
  const needle = Array.from(spec.query).map((c) => (spec.matchCase ? c : fold(c)));
  const size = needle.length;
  const hay = Array.from(line.slice(from, to));
  const offsets: number[] = [];
  let at = from;
  for (const c of hay) {
    offsets.push(at);
    at += c.length;
  }
  offsets.push(at);
  const out: Range[] = [];
  let i = 0;
  while (size > 0 && i + size <= hay.length) {
    if (needle.every((want, k) => (spec.matchCase ? hay[i + k] : fold(hay[i + k]!)) === want)) {
      const [start, end] = [offsets[i]!, offsets[i + size]!];
      if (!spec.wholeWord || (!WORD.test(charBefore(line, start)) && !WORD.test(charAt(line, end)))) {
        out.push([start, end]);
        i += size;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Every match in a page's body (the text under its frontmatter), in order. */
export function findInBody(body: string, spec: FindSpec): Found[] {
  const state: State = { fence: null, math: false, comment: false, html: false };
  const out: Found[] = [];
  let offset = 0;
  for (let line = 0; offset < body.length; line++) {
    const newline = body.indexOf("\n", offset);
    const next = newline < 0 ? body.length : newline + 1;
    let content = newline < 0 ? body.slice(offset) : body.slice(offset, newline);
    if (newline >= 0 && content.endsWith("\r")) content = content.slice(0, -1);
    for (const { range, ctx } of regionsOf(content, state)) {
      for (const [start, end] of findAll(content, range, spec)) out.push({ start: offset + start, end: offset + end, line, lineStart: offset, ctx });
    }
    offset = next;
  }
  return out;
}

/** Whether `title` holds the search text. */
export function titleMatches(title: string, spec: FindSpec): boolean {
  return spec.query !== "" && findAll(title, [0, title.length], spec).length > 0;
}

const AROUND = 40;

/** The first `limit` matches, each with its line around it. */
export function samplesOf(body: string, found: readonly Found[], limit: number): MatchSample[] {
  return found.slice(0, limit).map((m) => {
    const after = /[\r\n]/.exec(body.slice(m.end));
    const lineEnd = after ? m.end + after.index : body.length;
    return {
      line: m.line,
      before: Array.from(body.slice(m.lineStart, m.start)).slice(-AROUND).join(""),
      text: body.slice(m.start, m.end),
      after: Array.from(body.slice(m.end, lineEnd)).slice(0, AROUND).join(""),
    };
  });
}

// -- Escaping ---------------------------------------------------------------

function entityAt(chars: readonly string[], at: number): boolean {
  let n = at + 1;
  while (n < chars.length && /[\p{L}\p{N}#]/u.test(chars[n]!)) n++;
  return n > at + 1 && chars[n] === ";";
}

/** The replacement as Markdown prose: marks escaped, and what would start a block at the start of a line. */
function prose(withText: string, lineStart: boolean): string {
  const chars = Array.from(withText);
  const digits = chars.findIndex((c) => !/[0-9]/.test(c));
  const listDot = lineStart && digits >= 1 && digits <= 9 && (chars[digits] === "." || chars[digits] === ")") ? digits : -1;
  return chars
    .map((c, i) => {
      const inside = i > 0 && /[\p{L}\p{N}]/u.test(chars[i - 1]!) && /[\p{L}\p{N}]/u.test(chars[i + 1] ?? "");
      const escape =
        "\\`*[]<>|~$".includes(c) ||
        (c === "_" && !inside) ||
        (c === "&" && entityAt(chars, i)) ||
        ("#-+=".includes(c) && lineStart && i === 0) ||
        i === listDot;
      return escape ? `\\${c}` : c;
    })
    .join("");
}

/** The replacement as text inside HTML. */
function html(withText: string): string {
  const chars = Array.from(withText);
  return chars.map((c, i) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" && entityAt(chars, i) ? "&amp;" : c)).join("");
}

/** Whether only the start of a block precedes a match: spaces, quote marks and a list marker. */
function atBlockStart(before: string): boolean {
  let rest = before.trimStart();
  while (rest.startsWith(">")) rest = rest.slice(1).trimStart();
  const [first = "", ...others] = rest.split(" ");
  if (others.length > 0 && (["-", "+", "*"].includes(first) || /^\d+[.)]$/.test(first))) rest = others.join(" ");
  return rest.trim() === "";
}

// -- Checks and the replacement ----------------------------------------------

/** Refuses a search text that is not 1 to 200 characters of one line. */
export function checkSpec(spec: FindSpec): void {
  const length = Array.from(spec.query).length;
  if (length < 1 || length > 200) throw new Error("The text to find is 1 to 200 characters");
  if (/\p{Cc}/u.test(spec.query)) throw new Error("The text to find is one line, without tabs, line breaks or control characters");
}

/** Refuses a replacement that is not at most 1,000 characters of one line. */
export function checkWith(withText: string): void {
  if (Array.from(withText).length > 1000) throw new Error("The replacement is at most 1000 characters");
  if (/\p{Cc}/u.test(withText)) throw new Error("The replacement is one line, without tabs, line breaks or control characters");
}

/** `body` with every match replaced, and how many there were. Everything else stays as it was. */
export function replaceInBody(body: string, spec: FindSpec, withText: string): { text: string; count: number } {
  checkSpec(spec);
  checkWith(withText);
  const found = findInBody(body, spec);
  let out = "";
  let cursor = 0;
  for (const m of found) {
    const before = body.slice(m.lineStart, m.start);
    let piece: string;
    if (m.ctx === "prose") piece = prose(withText, atBlockStart(before));
    else if (m.ctx === "html") piece = html(withText);
    else {
      if (m.ctx === "inline" && withText.includes("`")) throw new Error("A replacement with a backtick would end a code span early, so nothing was replaced");
      if (m.ctx === "block" && before.trim() === "" && /^\s*(```|~~~)/.test(withText)) throw new Error("A replacement that starts with a code fence would end a code block, so nothing was replaced");
      piece = withText;
    }
    out += body.slice(cursor, m.start) + piece;
    cursor = m.end;
  }
  return { text: out + body.slice(cursor), count: found.length };
}
