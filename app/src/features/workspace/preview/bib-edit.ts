// The browser preview's edits of a `.bib` text, the same as the core's (`kasten-core`'s
// `bib::edit` and `bib::style`): a value changed where it stands, a field added after the
// last one in the entry's own style, a field taken out with its line, an entry renamed,
// replaced, added or copied. Every other byte stays, and each edit is checked against a
// second scan of the new text.

import { FIELD_ORDER } from "../../../lib/vault/reference-types";
import { fieldsOf, findEntry, macrosOf, scanBib, valueOf, type Field, type Span } from "./bib-scan";

interface Edit {
  start: number;
  end: number;
  with: string;
}

const fail = (why: string) => new Error(why);

/** The longest key, in characters. */
export const MOST_KEY = 128;

export function checkType(kind: string): string {
  const type = kind.trim().toLowerCase();
  if (!/^[a-z0-9]{1,24}$/.test(type)) throw fail("A type is a word such as article, inproceedings or book");
  if (["string", "comment", "preamble"].includes(type)) throw fail(`${type} is not a type of reference`);
  return type;
}

export function checkName(name: string): string {
  const n = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(n)) throw fail(`“${n}” cannot be a field name: use letters, digits, _ and -`);
  return n;
}

export function checkKey(key: string): string {
  const k = key.trim();
  if (!k) throw fail("A key is needed");
  if ([...k].length > MOST_KEY) throw fail(`A key is at most ${MOST_KEY} characters`);
  const edge = /^[\p{L}\p{N}_]$/u;
  const chars = [...k];
  if (!(edge.test(chars[0]!) && edge.test(chars.at(-1)!) && chars.every((c) => edge.test(c) || "-:./+?<>~&$".includes(c)))) {
    throw fail(`“${k}” cannot be a key: use letters, digits and _ - : . / + ? < > ~ & $, starting and ending with a letter, digit or _ (no spaces, commas, braces, quotes, backslashes, ( ) = @ % or #)`);
  }
  return k;
}

/** A field's value on one line, with its braces in pairs. */
export function checkValue(name: string, value: string): string {
  const v = value
    .split(/[\r\n]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (v.length > 16 * 1024) throw fail(`The ${name} is longer than a field can be`);
  // eslint-disable-next-line no-control-regex -- control characters are what is refused
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) throw fail(`The ${name} has a character a field cannot hold`);
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c === "\\") {
      if (i + 1 >= v.length) throw fail(`The ${name} ends with a backslash, which would swallow the brace after it`);
      i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) throw fail(`The ${name} has a } without a { before it`);
  }
  if (depth !== 0) throw fail(`The ${name} has a { without a } after it`);
  return v;
}

function hasOpenQuote(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === '"' && depth === 0) return true;
  }
  return false;
}

const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

/** The fields in the order they are written. */
export function ordered(fields: Record<string, string>): [string, string][] {
  const rank = (name: string) => {
    const at = (FIELD_ORDER as readonly string[]).indexOf(name);
    return at < 0 ? FIELD_ORDER.length : at;
  };
  return Object.entries(fields).sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1));
}

/** A new entry in house style, ending with a line break. */
export function renderEntry(type: string, key: string, fields: Record<string, string>, eol: string): string {
  return `@${type}{${key},${eol}${ordered(fields)
    .map(([name, value]) => `  ${name} = {${value}},${eol}`)
    .join("")}}${eol}`;
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let copied = 0;
  for (const e of sorted) {
    if (e.start < copied) throw fail("Those changes overlap; make them one at a time");
    out += text.slice(copied, e.start) + e.with;
    copied = e.end;
  }
  return out + text.slice(copied);
}

const blanks = (text: string, from: number) => {
  let at = from;
  while (text[at] === " " || text[at] === "\t") at++;
  return at;
};

function replacement(text: string, f: Field, value: string): Edit {
  const kind = f.pieces[0]?.kind;
  if (f.inner && (kind === "braced" || (kind === "quoted" && !hasOpenQuote(value)))) return { start: f.inner[0], end: f.inner[1], with: value };
  const bare = kind === "word" && f.pieces.length === 1 && /^\d+$/.test(text.slice(f.valueStart, f.valueEnd)) && /^\d+$/.test(value);
  return { start: f.valueStart, end: f.valueEnd, with: bare ? value : `{${value}}` };
}

function removal(text: string, f: Field): Edit {
  let end = f.end;
  const afterValue = blanks(text, end);
  const comma = text[afterValue] === ",";
  if (comma) end = afterValue + 1;
  const lineStart = text.lastIndexOf("\n", f.start - 1) + 1;
  const aloneBefore = /^[ \t]*$/.test(text.slice(lineStart, f.start));
  const tail = blanks(text, end);
  const lineEnd = tail + (text.startsWith("\r\n", tail) ? 2 : text[tail] === "\n" ? 1 : 0);
  if (aloneBefore && lineEnd > tail) return { start: lineStart, end: lineEnd, with: "" };
  if (comma) return { start: f.start, end: blanks(text, end), with: "" };
  const before = text.slice(0, f.start).trimEnd();
  if (before.endsWith(",")) return { start: before.length - 1, end: f.end, with: "" };
  return { start: f.start, end: f.end, with: "" };
}

/** The column the equals signs line up at and what follows them, when the entry's fields are lined up. */
function alignment(text: string, fields: Field[]): [number, string] | null {
  let column: number | null = null;
  let after = "";
  let wide = false;
  for (const f of fields) {
    const m = /^( +)=( *)$/.exec(text.slice(f.nameEnd, f.valueStart));
    if (!m) return null;
    const here = m[1]!.length + f.name.length;
    if (column !== null && column !== here) return null;
    column = here;
    wide ||= m[1]!.length > 1;
    after = m[2]!;
  }
  return wide && column !== null ? [column, after] : null;
}

function insertion(text: string, span: Span, added: Record<string, string>): Edit {
  const last = span.fields.at(-1);
  const anchor = last ? last.end : span.keyEnd;
  const after = blanks(text, anchor);
  const comma = text[after] === ",";
  const entry = text.slice(span.start, span.end);
  const multiline = entry.includes("\n");
  const eol = entry.includes("\r\n") ? "\r\n" : eolOf(text);
  let indent = "  ";
  if (last) {
    const lead = text.slice(text.lastIndexOf("\n", last.nameStart - 1) + 1, last.nameStart);
    if (lead && /^[ \t]*$/.test(lead)) indent = lead;
  }
  const aligned = multiline ? alignment(text, span.fields) : null;
  const lines = ordered(added).map(([name, value]) => {
    const sep = aligned ? `${" ".repeat(Math.max(1, aligned[0] - name.length))}=${aligned[1]}` : " = ";
    return `${name}${sep}{${value}}`;
  });
  if (multiline) {
    return comma
      ? { start: after + 1, end: after + 1, with: lines.map((l) => `${eol}${indent}${l},`).join("") }
      : { start: anchor, end: anchor, with: `,${lines.map((l) => `${eol}${indent}${l}`).join(",")}` };
  }
  return comma ? { start: after + 1, end: after + 1, with: lines.map((l) => ` ${l},`).join("") } : { start: anchor, end: anchor, with: lines.map((l) => `, ${l}`).join("") };
}

function verify(old: string, next: string, key: string, asked: Record<string, string | null>): void {
  const unsafe = () => fail(`The change to “${key}” could not be made safely; edit the file by hand`);
  const [oldSpans, newSpans] = [scanBib(old), scanBib(next)];
  const [before, after] = [findEntry(oldSpans, key), findEntry(newSpans, key)];
  if (!before || !after || !after.closed || next.slice(0, after.start) !== old.slice(0, before.start) || next.slice(after.end) !== old.slice(before.end) || after.type !== before.type) throw unsafe();
  const was = fieldsOf(old, before, macrosOf(old, oldSpans));
  const now = fieldsOf(next, after, macrosOf(next, newSpans));
  for (const [name, value] of Object.entries(asked)) if ((now[name] ?? null) !== value) throw unsafe();
  for (const [name, value] of Object.entries(was)) if (!(name in asked) && now[name] !== value) throw unsafe();
}

const missing = (key: string) => fail(`There is no reference with the key “${key}” in the managed file`);

/** The text with the fields set (null takes the field out) in the entry with this key. */
export function setFields(text: string, key: string, changes: Record<string, string | null>): string {
  const spans = scanBib(text);
  const span = findEntry(spans, key);
  if (!span) throw missing(key);
  if (!span.closed) throw fail(`The entry “${key}” is not closed in the file; close it by hand first`);
  const known = macrosOf(text, spans);
  const edits: Edit[] = [];
  const added: Record<string, string> = {};
  const asked: Record<string, string | null> = {};
  for (const [raw, change] of Object.entries(changes)) {
    const name = checkName(raw);
    const value = change === null ? null : checkValue(name, change) || null;
    const field = span.fields.find((f) => f.name === name);
    if (field && value !== null) {
      if (valueOf(text, field, known) !== value) edits.push(replacement(text, field, value));
    } else if (!field && value !== null) added[name] = value;
    else if (field) edits.push(removal(text, field));
    asked[name] = value;
  }
  if (Object.keys(added).length > 0) edits.push(insertion(text, span, added));
  if (edits.length === 0) return text;
  const next = applyEdits(text, edits);
  verify(text, next, key, asked);
  return next;
}

/** The text with the key of the entry `from` written as `to`. */
export function renameKey(text: string, from: string, to: string): string {
  const span = findEntry(scanBib(text), from);
  if (!span) throw missing(from);
  const next = applyEdits(text, [{ start: span.keyStart, end: span.keyEnd, with: to }]);
  if (!findEntry(scanBib(next), to)) throw fail(`Renaming “${from}” could not be done safely; edit the file by hand`);
  return next;
}

/** `entry` with the line breaks of `like`. */
export const withEolOf = (entry: string, like: string) => {
  const plain = entry.replace(/\r\n/g, "\n");
  return eolOf(like) === "\r\n" ? plain.replace(/\n/g, "\r\n") : plain;
};

/** The text with the entry `key` replaced by `replacement`: one whole, closed entry with the same key. */
export function replaceEntry(text: string, key: string, replacementText: string): string {
  const span = findEntry(scanBib(text), key);
  if (!span) throw missing(key);
  const wanted = replacementText.trim();
  const given = scanBib(wanted);
  const entries = given.filter((s) => s.kind === "entry");
  const stray = given.length > entries.length;
  if (entries.length !== 1) throw fail("Give one reference: a single @type{key, ...} entry");
  const entry = entries[0]!;
  if (entry.key !== key) throw fail(`The key has to stay “${key}”; use Rename key to change it, so the citations follow`);
  const outside = wanted.slice(0, entry.start).trim() !== "" || wanted.slice(entry.end).trim() !== "";
  if (stray || outside || !entry.closed) throw fail("That is not one complete entry: close its last brace and leave out anything around it");
  return applyEdits(text, [{ start: span.start, end: span.end, with: withEolOf(wanted, text) }]);
}

/** The text with `chunk` added at the end, a blank line after what is there. */
export function appendChunk(text: string, chunk: string): string {
  const eol = eolOf(text);
  let out = text;
  if (out) {
    if (!out.endsWith("\n")) out += eol;
    if (!out.endsWith("\n\n") && !out.endsWith("\r\n\r\n")) out += eol;
  }
  out += withEolOf(chunk, text);
  return out.endsWith("\n") ? out : out + eol;
}

/** Entries of `source` (those named by `keys`, or all) as text to add to `into`, with the macros they use; and why some were left. */
export function pick(source: string, keys: string[] | null, into: string): { chunks: [string, string][]; skipped: { key: string; why: string }[] } {
  const spans = scanBib(source);
  const sourceMacros = macrosOf(source, spans);
  const intoSpans = scanBib(into);
  const intoMacros = macrosOf(into, intoSpans);
  const defs = new Map(spans.filter((s) => s.kind === "string" && s.fields[0]).map((s) => [s.fields[0]!.name, s] as const));
  const used = (span: Span) => span.fields.flatMap((f) => f.pieces.filter((p) => p.kind === "word").map((p) => source.slice(p.start, p.end).toLowerCase())).filter((w) => !/^\d+$/.test(w));
  const needed = (span: Span, out: string[], path: string[]) => {
    for (const name of used(span)) {
      const def = defs.get(name);
      if (out.includes(name) || path.includes(name) || path.length >= 32 || !def) continue;
      needed(def, out, [...path, name]);
      out.push(name);
    }
  };
  const chunks: [string, string][] = [];
  const skipped: { key: string; why: string }[] = [];
  const seen = new Set<string>();
  const emitted = new Set<string>();
  for (const span of spans.filter((s) => s.kind === "entry")) {
    if ((keys && !keys.includes(span.key)) || seen.has(span.key)) continue;
    seen.add(span.key);
    if (findEntry(intoSpans, span.key)) skipped.push({ key: span.key, why: "the managed file has that key already" });
    else if (!span.closed) skipped.push({ key: span.key, why: "it never closes in that file" });
    else {
      const names: string[] = [];
      needed(span, names, []);
      const clash = names.find((n) => intoMacros.has(n) && sourceMacros.get(n) !== intoMacros.get(n));
      if (clash) {
        skipped.push({ key: span.key, why: `it uses the macro ${clash}, which the managed file defines differently` });
        continue;
      }
      let chunk = "";
      for (const n of names) {
        const def = defs.get(n);
        if (def && !intoMacros.has(n) && !emitted.has(n)) {
          emitted.add(n);
          chunk += `${source.slice(def.start, def.end)}\n`;
        }
      }
      chunks.push([span.key, chunk + source.slice(span.start, span.end)]);
    }
  }
  for (const key of keys ?? []) if (!seen.has(key)) skipped.push({ key, why: "it is not in that file" });
  return { chunks, skipped };
}
