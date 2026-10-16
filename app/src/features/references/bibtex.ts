// BibTeX the person pastes, read here with no lookup of any kind. The reader is
// tolerant: it never throws, takes what it can from an entry that is not
// closed, skips comments and preambles, and reads `@string` macros so a value
// that names one comes out in full. A value comes out as the file would give
// it to the vault's own reader: outer braces or quotes off, macros put in,
// LaTeX left in. Each entry also says where in the text it was written, so a
// raw edit can show and replace exactly that stretch.

import { FIELD_ORDER } from "../../lib/vault/reference-types";

export interface ParsedEntry {
  /** In lower case: `article`, `inproceedings`... */
  type: string;
  key: string;
  /** By lower-case name; the first of a name stands. */
  fields: Record<string, string>;
  /** From the `@` to just after the closing brace. */
  start: number;
  end: number;
  closed: boolean;
}

export interface Scanned {
  entries: ParsedEntry[];
  /** In words, for the person. */
  problems: string[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BLANKS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const WORD_ENDS = new Set([",", "#", "}", ")", "{", '"', "="]);
/** The most text read, so a hostile paste cannot hold the window. */
const MOST = 4 * 1024 * 1024;

const skipBlank = (text: string, from: number): number => {
  let i = from;
  while (i < text.length && BLANKS.has(text[i]!)) i++;
  return i;
};

/** Just after the `}` that closes the `{` at `from`, and whether it was closed. */
function braced(text: string, from: number): [number, boolean] {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return [i + 1, true];
  }
  return [text.length, false];
}

/** Past a `@comment` or `@preamble` group whose opening bracket is at `open`. */
function skipGroup(text: string, open: number): number {
  if (text[open] === "{") return braced(text, open)[0];
  let depth = 0;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === ")" && depth === 0) return i + 1;
  }
  return text.length;
}

interface Value {
  value: string;
  end: number;
  closed: boolean;
}

/** A value: braces, quotes or a bare word (a number, a month or a macro), joined by `#`. */
function readValue(text: string, from: number, macros: Map<string, string>): Value {
  let out = "";
  let p = skipBlank(text, from);
  for (;;) {
    const c = text[p];
    if (c === "{") {
      const [end, closed] = braced(text, p);
      out += text.slice(p + 1, closed ? end - 1 : end);
      p = end;
      if (!closed) return { value: out, end: p, closed: false };
    } else if (c === '"') {
      let depth = 0;
      let j = p + 1;
      while (j < text.length && (text[j] !== '"' || depth > 0)) {
        if (text[j] === "\\") j++;
        else if (text[j] === "{") depth++;
        else if (text[j] === "}") depth = Math.max(0, depth - 1);
        j++;
      }
      out += text.slice(p + 1, Math.min(j, text.length));
      if (j >= text.length) return { value: out, end: text.length, closed: false };
      p = j + 1;
    } else {
      let j = p;
      while (j < text.length && !BLANKS.has(text[j]!) && !WORD_ENDS.has(text[j]!)) j++;
      if (j === p) return { value: out, end: p, closed: true };
      const word = text.slice(p, j);
      const month = word.length === 3 ? MONTHS.find((m) => m.slice(0, 3).toLowerCase() === word.toLowerCase()) : undefined;
      out += /^\d+$/.test(word) ? word : (macros.get(word.toLowerCase()) ?? month ?? word);
      p = j;
    }
    p = skipBlank(text, p);
    if (text[p] !== "#") return { value: out, end: p, closed: true };
    p = skipBlank(text, p + 1);
  }
}

/** The entries in `text`, with what could not be read said in words. */
export function parseBibtex(input: string): Scanned {
  const text = input.length > MOST ? input.slice(0, MOST) : input;
  const macros = new Map<string, string>();
  const entries: ParsedEntry[] = [];
  const problems: string[] = [];
  const head = /@\s*([A-Za-z]+)\s*([({])/y;
  const name = /[A-Za-z][\w:.-]*/y;
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    head.lastIndex = at;
    const found = head.exec(text);
    if (!found) {
      i = at + 1;
      continue;
    }
    const type = found[1]!.toLowerCase();
    const open = at + found[0].length - 1;
    if (type === "comment" || type === "preamble") {
      i = skipGroup(text, open);
      continue;
    }
    let p = skipBlank(text, open + 1);
    if (type === "string") {
      name.lastIndex = p;
      const macro = name.exec(text);
      if (macro) {
        p = skipBlank(text, p + macro[0].length);
        if (text[p] === "=") {
          const read = readValue(text, p + 1, macros);
          macros.set(macro[0].toLowerCase(), read.value);
          p = read.end;
        }
      }
      p = skipBlank(text, p);
      i = text[p] === "}" || text[p] === ")" ? p + 1 : Math.max(p, at + 1);
      continue;
    }
    let k = p;
    while (k < text.length && !BLANKS.has(text[k]!) && ![",", "}", ")", "{"].includes(text[k]!)) k++;
    const key = text.slice(p, k);
    if (!key) {
      problems.push(`An @${type} entry has no key, so it was left out`);
      i = Math.max(k, at + 1);
      continue;
    }
    const fields: Record<string, string> = {};
    let closed = false;
    p = k;
    for (;;) {
      p = skipBlank(text, p);
      const c = text[p];
      if (c === undefined || c === "@") break;
      if (c === ",") {
        p++;
        continue;
      }
      if (c === "}" || c === ")") {
        p++;
        closed = true;
        break;
      }
      name.lastIndex = p;
      const field = name.exec(text);
      if (!field) {
        p++;
        continue;
      }
      p = skipBlank(text, p + field[0].length);
      if (text[p] !== "=") continue;
      const read = readValue(text, p + 1, macros);
      const lower = field[0].toLowerCase();
      if (!(lower in fields)) fields[lower] = read.value;
      p = read.end;
      if (!read.closed) break;
    }
    if (!closed) problems.push(`The entry “${key}” is not closed, so it was read as far as it goes`);
    entries.push({ type, key, fields, start: at, end: Math.min(p, text.length), closed });
    i = Math.max(p, at + 1);
  }
  return { entries, problems };
}

/** Each closed entry's own text by key (the first of a key), `@` to closing brace. */
export function entryTexts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of parseBibtex(text).entries) if (entry.closed && !out.has(entry.key)) out.set(entry.key, text.slice(entry.start, entry.end));
  return out;
}

/** An entry written in the vault's house style: two-space fields, each ending in a comma, the usual fields first. */
export function renderEntry(type: string, key: string, fields: Record<string, string>): string {
  const rank = (name: string) => {
    const at = (FIELD_ORDER as readonly string[]).indexOf(name);
    return at < 0 ? FIELD_ORDER.length : at;
  };
  const names = Object.keys(fields)
    .filter((name) => (fields[name] ?? "").trim() !== "")
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const lines = names.map((name) => `  ${name} = {${(fields[name] ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim()}},\n`);
  return `@${type.toLowerCase()}{${key},\n${lines.join("")}}`;
}
