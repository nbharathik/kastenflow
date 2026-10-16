// The browser preview's BibTeX scanner: where each entry, field and value is written
// (the same walk as the core's `slides-bib` crate, kept as simple), so the preview can
// edit a `.bib` text the way the core does: only the bytes of what changed.

export type PieceKind = "braced" | "quoted" | "word";

/** One piece of a value; a value is pieces joined by `#`. `start`..`end` is inside the braces or quotes. */
export interface Piece {
  kind: PieceKind;
  start: number;
  end: number;
}

export interface Field {
  name: string;
  nameStart: number;
  nameEnd: number;
  /** From the name to the end of the value. */
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  pieces: Piece[];
  /** Inside the braces or quotes, when the value is exactly one closed braced or quoted piece. */
  inner: [number, number] | null;
}

export interface Span {
  kind: "entry" | "string" | "comment" | "preamble";
  start: number;
  end: number;
  /** The entry type in lower case. */
  type: string;
  /** The key of an entry, or the name of a macro. */
  key: string;
  keyStart: number;
  keyEnd: number;
  fields: Field[];
  closed: boolean;
}

const BLANK = new Set([" ", "\t", "\n", "\r", "\v", "\f"]);
const ENDS_WORD = new Set([..." \t\n\r\v\f", ",", "}", ")", "{", "(", '"', "#", "="]);
const isFieldName = (c: string) => /[A-Za-z0-9_\-:.]/.test(c);
const isAlnum = (c: string) => /[A-Za-z0-9]/.test(c);

class Reader {
  at = 0;
  closed = false;
  constructor(readonly text: string) {}

  peek(): string | undefined {
    return this.text[this.at];
  }

  blank(): void {
    while (this.at < this.text.length && BLANK.has(this.text[this.at]!)) this.at++;
  }

  /** Whether an entry begins at the `@` at `at`. */
  private begins(at: number): boolean {
    let i = at + 1;
    const first = i;
    while (i < this.text.length && /[A-Za-z]/.test(this.text[i]!)) i++;
    if (i === first) return false;
    while (i < this.text.length && BLANK.has(this.text[i]!)) i++;
    return this.text[i] === "{" || this.text[i] === "(";
  }

  private entryAfter(at: number): boolean {
    return this.text[at + 1] === "@" && this.begins(at + 1);
  }

  /** After a `{`: the inside's end and whether it was cut short. */
  braced(): [number, boolean] {
    let depth = 1;
    while (this.at < this.text.length) {
      const c = this.text[this.at]!;
      if (c === "\\") this.at++;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const end = this.at;
          this.at++;
          return [end, false];
        }
      } else if (c === "\n" && this.entryAfter(this.at)) {
        const end = this.at;
        this.at++;
        return [end, true];
      }
      this.at++;
    }
    this.at = this.text.length;
    return [this.text.length, true];
  }

  /** After a `"`: the inside's end and whether it was cut short. */
  quoted(): [number, boolean] {
    let depth = 0;
    while (this.at < this.text.length) {
      const c = this.text[this.at]!;
      if (c === "\\") this.at++;
      else if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === '"' && depth === 0) {
        const end = this.at;
        this.at++;
        return [end, false];
      } else if (c === "\n" && this.entryAfter(this.at)) {
        const end = this.at;
        this.at++;
        return [end, true];
      }
      this.at++;
    }
    this.at = this.text.length;
    return [this.text.length, true];
  }

  skipGroup(open: string): void {
    if (open === "{") {
      this.closed = !this.braced()[1];
      return;
    }
    let depth = 0;
    while (this.at < this.text.length) {
      const c = this.text[this.at]!;
      this.at++;
      if (c === "\\") this.at++;
      else if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === ")" && depth === 0) {
        this.closed = true;
        return;
      } else if (c === "\n" && this.entryAfter(this.at - 1)) return;
    }
    this.at = this.text.length;
  }

  name(): [number, number] {
    const start = this.at;
    while (this.at < this.text.length && !ENDS_WORD.has(this.text[this.at]!)) this.at++;
    return [start, this.at];
  }

  private value(): { pieces: Piece[]; broken: boolean; start: number; end: number } {
    this.blank();
    const start = this.at;
    let end = start;
    const pieces: Piece[] = [];
    let broken = false;
    for (;;) {
      this.blank();
      const c = this.peek();
      let piece: Piece;
      let outer: number;
      if (c === "{" || c === '"') {
        const begin = ++this.at;
        const [inside, cut] = c === "{" ? this.braced() : this.quoted();
        broken = cut;
        piece = { kind: c === "{" ? "braced" : "quoted", start: begin, end: inside };
        outer = cut ? inside : inside + 1;
      } else if (c !== undefined && !ENDS_WORD.has(c)) {
        const [from, to] = this.name();
        piece = { kind: "word", start: from, end: to };
        outer = to;
      } else break;
      end = outer;
      pieces.push(piece);
      if (broken) break;
      this.blank();
      if (this.peek() === "#") this.at++;
      else break;
    }
    return { pieces, broken, start, end };
  }

  field(nameStart: number, nameEnd: number): [Field, boolean] {
    const v = this.value();
    const only = v.pieces.length === 1 ? v.pieces[0]! : null;
    const inner: [number, number] | null = only && only.kind !== "word" && !v.broken ? [only.start, only.end] : null;
    return [
      { name: this.text.slice(nameStart, nameEnd).toLowerCase(), nameStart, nameEnd, start: nameStart, end: v.end, valueStart: v.start, valueEnd: v.end, pieces: v.pieces, inner },
      v.broken,
    ];
  }

  skipRest(): void {
    while (this.at < this.text.length) {
      const c = this.text[this.at]!;
      if (c === "}" || c === ")") {
        this.at++;
        this.closed = true;
        return;
      }
      if (c === "@") return;
      if (c === "\\") this.at += 2;
      else if (c === "{") {
        this.at++;
        this.braced();
      } else this.at++;
    }
    this.at = this.text.length;
  }

  fields(keyEnd: number): [Field[], number] {
    const fields: Field[] = [];
    let last = keyEnd;
    for (;;) {
      this.blank();
      const c = this.peek();
      if (c === undefined || c === "@") break;
      if (c === ",") {
        this.at++;
        continue;
      }
      if (c === "}" || c === ")") {
        this.at++;
        this.closed = true;
        return [fields, Math.min(this.at, this.text.length)];
      }
      const start = this.at;
      while (this.at < this.text.length && isFieldName(this.text[this.at]!)) this.at++;
      if (this.at === start) break;
      const nameEnd = this.at;
      this.blank();
      if (this.peek() !== "=") break;
      this.at++;
      const [field, broken] = this.field(start, nameEnd);
      last = Math.max(last, field.end);
      fields.push(field);
      if (broken) break;
    }
    return [fields, last];
  }
}

/** The entries, `@string` macros, comments and preambles of a text, in order. */
export function scanBib(text: string): Span[] {
  const r = new Reader(text);
  const spans: Span[] = [];
  for (;;) {
    const found = text.indexOf("@", r.at);
    if (found < 0) break;
    const sign = found;
    r.at = found + 1;
    r.blank();
    const wordStart = r.at;
    while (r.at < text.length && isAlnum(text[r.at]!)) r.at++;
    if (r.at === wordStart) continue;
    const type = text.slice(wordStart, r.at).toLowerCase();
    r.blank();
    const open = r.peek();
    if (open !== "{" && open !== "(") continue;
    r.at++;
    r.closed = false;
    const none = { type, key: "", keyStart: 0, keyEnd: 0, fields: [] as Field[] };
    if (type === "comment" || type === "preamble") {
      r.skipGroup(open);
      spans.push({ ...none, kind: type, start: sign, end: Math.min(r.at, text.length), closed: r.closed });
    } else if (type === "string") {
      r.blank();
      const [nameStart, nameEnd] = r.name();
      r.blank();
      const fields: Field[] = [];
      if (nameEnd > nameStart && r.peek() === "=") {
        r.at++;
        const [field] = r.field(nameStart, nameEnd);
        if (field.pieces.length > 0) fields.push(field);
      }
      r.skipRest();
      spans.push({ ...none, kind: "string", key: text.slice(nameStart, nameEnd), keyStart: nameStart, keyEnd: nameEnd, fields, start: sign, end: Math.min(r.at, text.length), closed: r.closed });
    } else {
      r.blank();
      const keyStart = r.at;
      while (r.at < text.length && (!ENDS_WORD.has(text[r.at]!) || text[r.at] === "#")) r.at++;
      if (r.at === keyStart) {
        r.skipRest();
        continue;
      }
      const keyEnd = r.at;
      const [fields, end] = r.fields(keyEnd);
      spans.push({ ...none, kind: "entry", key: text.slice(keyStart, keyEnd), keyStart, keyEnd, fields, start: sign, end, closed: r.closed });
    }
  }
  return spans;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A field's value with its pieces put together and macros put in; null when it has no piece. */
export function valueOf(text: string, field: Field, macros: Map<string, string>): string | null {
  if (field.pieces.length === 0) return null;
  let out = "";
  for (const p of field.pieces) {
    const inside = text.slice(p.start, p.end);
    if (p.kind !== "word") out += inside;
    else if (/^\d+$/.test(inside)) out += inside;
    else {
      const known = macros.get(inside.toLowerCase());
      const month = inside.length === 3 ? MONTHS.find((m) => m.slice(0, 3).toLowerCase() === inside.toLowerCase()) : undefined;
      out += known ?? month ?? inside;
    }
  }
  return out;
}

/** The macros of the `@string` spans, each put in as the ones before it stand. */
export function macrosOf(text: string, spans: Span[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const s of spans) {
    if (s.kind !== "string" || !s.fields[0]) continue;
    const value = valueOf(text, s.fields[0], known);
    if (value !== null) known.set(s.fields[0].name, value);
  }
  return known;
}

/** The fields of an entry by lower-case name; the first of a name stands. */
export function fieldsOf(text: string, span: Span, macros: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of span.fields) {
    const value = valueOf(text, f, macros);
    if (value !== null && !(f.name in out)) out[f.name] = value;
  }
  return out;
}

/** The entries of a text as the core lists them: a macro is known to the entries after its `@string`. */
export function entriesOf(text: string): { key: string; type: string; fields: Record<string, string> }[] {
  const macros = new Map<string, string>();
  const out: { key: string; type: string; fields: Record<string, string> }[] = [];
  for (const s of scanBib(text)) {
    if (s.kind === "string" && s.fields[0]) {
      const value = valueOf(text, s.fields[0], macros);
      if (value !== null) macros.set(s.fields[0].name, value);
    } else if (s.kind === "entry") out.push({ key: s.key, type: s.type, fields: fieldsOf(text, s, macros) });
  }
  return out;
}

/** The first entry with this key. */
export function findEntry(spans: Span[], key: string): Span | undefined {
  return spans.find((s) => s.kind === "entry" && s.key === key);
}
