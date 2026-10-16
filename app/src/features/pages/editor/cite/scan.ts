// Finding Pandoc-style citations in the text of one block: `[@key]`,
// `[@key, p. 4]`, `[see @a; @b]`, `[-@key]`. This is the vault's own rule
// (the core's page scanner): a citation is inside square brackets, an `@`
// begins a key only after the bracket, a space, a `;` or a `-` that itself
// follows one of those, so an address is not one, and wiki links, `[text](url)`,
// `[text][ref]`, `[ref]:` and escaped brackets are left out. The editor hands
// this the text of a block with code and links already replaced by a stand-in
// character, so neither is looked into.

export interface CiteItem {
  key: string;
  /** Where the `@` is (the `-` before it for a suppressed author). */
  at: number;
  /** The key alone: from just after the `@` to just after its last character. */
  keyFrom: number;
  keyTo: number;
  /** Written `-@key`: the author's name is left out. */
  suppress: boolean;
}

export interface CiteGroup {
  /** The `[`, and just after the `]`. */
  from: number;
  to: number;
  items: CiteItem[];
}

/** The longest stretch inside one pair of brackets that is looked at. */
const LONGEST_GROUP = 2000;
const INNER = new Set([":", ".", "#", "$", "%", "&", "-", "+", "?", "<", ">", "~", "/"]);

const isKeyChar = (c: string | undefined) => c !== undefined && /^[\p{L}\p{N}_]$/u.test(c);

/** Just after the key that starts at `at` of `text`, or null when no key does. */
function keyEnd(text: string, at: number, limit: number): number | null {
  const chars = [...text.slice(at, limit)];
  if (!isKeyChar(chars[0])) return null;
  let length = chars[0]!.length;
  for (let i = 1; i < chars.length; i++) {
    const c = chars[i]!;
    if (isKeyChar(c)) length += c.length;
    else if (INNER.has(c) && isKeyChar(chars[i + 1])) length += c.length;
    else break;
  }
  return at + length;
}

/** The `]` that closes the `[` at `open`, with the brackets inside balanced; -1 when none does. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length && i - open <= LONGEST_GROUP; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

function itemsIn(text: string, start: number, end: number): CiteItem[] {
  const items: CiteItem[] = [];
  const group = text.slice(start, end);
  let j = 0;
  for (let at = group.indexOf("@", j); at >= 0; at = group.indexOf("@", j)) {
    j = at + 1;
    const before = group[at - 1];
    const dashed = before === "-" && (at < 2 || group[at - 2] === " " || group[at - 2] === ";");
    if (!(before === undefined || before === " " || before === ";" || dashed)) continue;
    const stop = keyEnd(group, at + 1, group.length);
    if (stop === null) continue;
    items.push({ key: group.slice(at + 1, stop), at: start + at - (dashed ? 1 : 0), keyFrom: start + at + 1, keyTo: start + stop, suppress: dashed });
    j = stop;
  }
  return items;
}

/** The groups of citations in `text`, in order. */
export function citationGroups(text: string): CiteGroup[] {
  const out: CiteGroup[] = [];
  if (!text.includes("@") || !text.includes("[")) return out;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "[" || text[i - 1] === "\\") {
      i++;
      continue;
    }
    if (text[i + 1] === "[") {
      // A wiki link: on to its end.
      const end = text.indexOf("]]", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    const close = closing(text, i);
    if (close < 0) {
      i++;
      continue;
    }
    const next = text[close + 1];
    // A link `[text](target)`, a reference link `[text][ref]` or a definition `[ref]:`.
    if (next === "(" || next === "[" || next === ":") {
      i = close + 1;
      continue;
    }
    const items = itemsIn(text, i + 1, close);
    if (items.length > 0) out.push({ from: i, to: close + 1, items });
    i = close + 1;
  }
  return out;
}

/** The stretches of `text` to write exactly as they are: each group's brackets and its keys with their `@`. The words between are ordinary text. */
export function citationRawRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const group of citationGroups(text)) {
    out.push([group.from, group.from + 1]);
    for (const item of group.items) out.push([item.at, item.keyTo]);
    out.push([group.to - 1, group.to]);
  }
  return out;
}
