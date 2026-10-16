// The works of a bibliography, for the clip form to choose a citation key from.
// It reads the text of the vault's `.bib` files as the vault gives it and takes
// what a person remembers of a work: its key, authors, title, year and where it
// appeared. Slides reads the same text for the citations themselves, so this
// reader only has to be tolerant and small: it never throws, it stops at a
// budget on hostile text, and a key in two entries is the first one's.

export interface Work {
  key: string;
  /** `article`, `inproceedings`, `book`... in lower case. */
  type: string;
  title: string;
  /** As written ("Vaswani, Ashish" or "Ashish Vaswani"), with accents and braces resolved. */
  authors: string[];
  /** The author list ended with `and others`. */
  more: boolean;
  year: string;
  /** The journal, conference, publisher or institution. */
  venue: string;
}

/** The most text read, the longest an entry may be, and the most works kept. */
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_ENTRY = 64 * 1024;
const MAX_WORKS = 20_000;
/** Entries that are not works. */
const SKIPPED = new Set(["comment", "string", "preamble"]);
const VENUES = ["journal", "booktitle", "journaltitle", "publisher", "institution", "school", "organization", "howpublished"];

const ACCENTS: Record<string, string> = { "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇", c: "̧", v: "̌", u: "̆", H: "̋", k: "̨", r: "̊" };
const LETTERS: Record<string, string> = { L: "Ł", l: "ł", O: "Ø", o: "ø", ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", i: "i", j: "j" };

/** A field's text as it reads: LaTeX accents and special letters written out, braces and ties gone. */
function plain(raw: string): string {
  return raw
    .replace(/\\([`'^"~=.])\s*\{?\\?([A-Za-z])\}?/g, (_, mark: string, letter: string) => letter + ACCENTS[mark])
    .replace(/\\([cvuHkr])(?:\s*\{\\?([A-Za-z])\}|\s+([A-Za-z]))/g, (_, mark: string, braced?: string, spaced?: string) => (braced ?? spaced ?? "") + ACCENTS[mark])
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|L|l|O|o|i|j)(?![A-Za-z])\s*/g, (_, name: string) => LETTERS[name] ?? "")
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

/** The index after the `}` that closes the `{` at `from`, or -1 when it is not closed before `limit`. */
function closing(text: string, from: number, limit: number): number {
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const c = text.charCodeAt(i);
    if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return i + 1;
  }
  return -1;
}

const SPACE = /\s/;
const skipSpace = (text: string, from: number, limit: number) => {
  let i = from;
  while (i < limit && SPACE.test(text[i]!)) i++;
  return i;
};

/** A value: braces, quotes or a bare word (a number or a macro), joined by `#`. Braces inside are kept. Null when it is none of these. */
function value(text: string, from: number, limit: number, stop: string): [string, number] | null {
  let out = "";
  let i = skipSpace(text, from, limit);
  for (;;) {
    const c = text[i];
    if (c === "{") {
      const end = closing(text, i, limit);
      if (end < 0) {
        // Not closed before the end of the entry: what was written is the value.
        return [out + text.slice(i + 1, limit).trimEnd(), limit];
      }
      out += text.slice(i + 1, end - 1);
      i = end;
    } else if (c === '"') {
      let depth = 0;
      let j = i + 1;
      while (j < limit && (text[j] !== '"' || depth > 0)) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth = Math.max(0, depth - 1);
        j++;
      }
      out += text.slice(i + 1, j);
      i = Math.min(j + 1, limit);
    } else {
      let j = i;
      while (j < limit && !SPACE.test(text[j]!) && text[j] !== "," && text[j] !== "#" && text[j] !== stop && text[j] !== "}") j++;
      if (j === i) return out === "" ? null : [out, i];
      out += text.slice(i, j);
      i = j;
    }
    i = skipSpace(text, i, limit);
    if (text[i] !== "#") return [out, i];
    i = skipSpace(text, i + 1, limit);
  }
}

interface Raw {
  type: string;
  key: string;
  fields: Map<string, string>;
}

/**
 * Reads the entry whose `@` is at `start`, looking no further than `limit`. `next` is where to go on reading, `seen` how far
 * it looked (a failed entry may have looked a long way), and `raw` is null for what is not a work.
 */
function entry(text: string, start: number, limit: number): { raw: Raw | null; next: number; seen: number } {
  const head = /@\s*([A-Za-z]+)\s*([{(])/y;
  head.lastIndex = start;
  const found = head.exec(text);
  if (!found) return { raw: null, next: start + 1, seen: start + 1 };
  const type = found[1]!.toLowerCase();
  const stop = found[2] === "{" ? "}" : ")";
  const body = start + found[0].length;
  if (SKIPPED.has(type)) {
    // Skipped whole, so the entries written inside a comment are not read.
    const end = found[2] === "{" ? closing(text, body - 1, limit) : text.indexOf(")", body);
    const to = end < 0 || end > limit ? body : end;
    return { raw: null, next: to, seen: Math.max(to, limit) };
  }
  let i = body;
  while (i < limit && text[i] !== "," && text[i] !== stop) i++;
  const key = text.slice(body, i).trim();
  if (!key || /[\s{}"@]/.test(key)) return { raw: null, next: body, seen: i };
  const fields = new Map<string, string>();
  while (i < limit) {
    const before = i;
    i = skipSpace(text, i, limit);
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (i >= limit || text[i] === stop) break;
    const named = /[A-Za-z][\w:.-]*/y;
    named.lastIndex = i;
    const name = named.exec(text)?.[0].toLowerCase();
    if (name) {
      i = skipSpace(text, i + name.length, limit);
      const read = text[i] === "=" ? value(text, i + 1, limit, stop) : null;
      if (read) {
        i = read[1];
        if (!fields.has(name)) fields.set(name, read[0]);
      }
    }
    if (i === before) i++;
  }
  return { raw: { type, key, fields }, next: Math.min(i + 1, limit), seen: i };
}

/** The names of an author field, split at `and` outside braces. */
function names(raw: string): string[] {
  const out: string[] = [];
  const and = /\s+and\s+/iy;
  let depth = 0;
  let from = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && SPACE.test(c)) {
      and.lastIndex = i;
      const found = and.exec(raw);
      if (found) {
        out.push(raw.slice(from, i));
        i += found[0].length - 1;
        from = i + 1;
      }
    }
  }
  out.push(raw.slice(from));
  return out.map(plain).filter(Boolean);
}

function workOf(raw: Raw): Work {
  const field = (name: string) => plain(raw.fields.get(name) ?? "");
  const people = names(raw.fields.get("author") ?? raw.fields.get("editor") ?? "");
  const more = people.at(-1)?.toLowerCase() === "others";
  return {
    key: raw.key,
    type: raw.type,
    title: field("title"),
    authors: more ? people.slice(0, -1) : people,
    more,
    year: /\d{4}/.exec(field("year"))?.[0] ?? /\d{4}/.exec(field("date"))?.[0] ?? "",
    venue: VENUES.map(field).find(Boolean) ?? "",
  };
}

/** A work from an entry the vault's bibliography call gave: its fields by lower-case name, as written. */
export function workOfEntry(entry: { key: string; type: string; fields: Record<string, string> }): Work {
  return workOf({ key: entry.key, type: entry.type.toLowerCase(), fields: new Map(Object.entries(entry.fields)) });
}

/** The works of a bibliography, in the order they are written. */
export function readWorks(text: string): Work[] {
  const source = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const works: Work[] = [];
  const seen = new Set<string>();
  // An entry is over by the next line that begins with an `@`, or after the longest an entry may be. The lines are found once.
  const lines: number[] = [];
  for (const line of source.matchAll(/^[ \t]*@/gm)) lines.push(line.index + line[0].length - 1);
  // Reading is bounded by what was looked at, not by how the text is shaped: a file of nothing but starts of entries is quick.
  let budget = 4 * source.length + 1_000_000;
  let line = 0;
  for (let at = source.indexOf("@"); at >= 0 && budget > 0 && works.length < MAX_WORKS; ) {
    while (line < lines.length && lines[line]! <= at) line++;
    const limit = Math.min(lines[line] ?? source.length, at + MAX_ENTRY);
    const read = entry(source, at, limit);
    budget -= Math.max(read.seen - at, 1);
    if (read.raw && !seen.has(read.raw.key)) {
      seen.add(read.raw.key);
      works.push(workOf(read.raw));
    }
    at = source.indexOf("@", Math.max(read.next, at + 1));
  }
  return works;
}

/** A person's last name from "Last, First" or "First Last". */
export function lastName(name: string): string {
  const comma = name.indexOf(",");
  return comma >= 0 ? name.slice(0, comma).trim() : (name.split(/\s+/).at(-1) ?? name);
}

/** How a short citation names the work: `Vaswani et al., 2017`, `Devlin and Chang, 2019`, `LeCun, 2015`. Empty when it has no author. */
export function cite(work: Work): string {
  const last = work.authors.map(lastName);
  const who = last.length === 0 ? "" : last.length === 1 && !work.more ? last[0]! : last.length === 2 && !work.more ? `${last[0]} and ${last[1]}` : `${last[0]} et al.`;
  return who && work.year ? `${who}, ${work.year}` : who;
}

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * The works that hold every word of `query` (in the key, title, authors, year or venue), best first: those whose key
 * starts with what was typed, then whose key holds it, then whose title holds every word, then the rest; each group
 * in the order the works were written. With nothing typed, all of them in that order.
 */
export function matchWorks(works: readonly Work[], query: string): Work[] {
  const terms = wordsOf(query);
  if (terms.length === 0) return [...works];
  const typed = query.trim().toLowerCase();
  const found: { work: Work; score: number; at: number }[] = [];
  works.forEach((work, at) => {
    const text = [work.key, work.title, ...work.authors, work.year, work.venue].join(" ").toLowerCase();
    if (!terms.every((term) => text.includes(term))) return;
    const key = work.key.toLowerCase();
    const title = work.title.toLowerCase();
    const score = key.startsWith(typed) ? 0 : key.includes(typed) ? 1 : terms.every((term) => title.includes(term)) ? 2 : 3;
    found.push({ work, score, at });
  });
  return found.sort((a, b) => a.score - b.score || a.at - b.at).map((f) => f.work);
}
