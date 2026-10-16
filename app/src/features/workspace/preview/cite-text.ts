// The browser preview's reading of Pandoc citations in a page (`[@key]`, `[see @a; @b]`,
// `[-@key]`), the same as the core's `cite` module: only inside square brackets, not in
// code, links, wiki links or the frontmatter. Enough for the preview to count and rename
// a key; the page editor has its own.

const keyChar = (c: string) => /^[\p{L}\p{N}_]$/u.test(c);
const inner = (c: string) => ":.#$%&-+?<>~/".includes(c);

/** Where the keys are written, as ranges of the text, without their `@`. */
export function citations(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const bom = text.startsWith(String.fromCharCode(0xfeff)) ? 1 : 0;
  const front = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.slice(bom));
  let offset = bom + (front ? front[0].length : 0);
  let fence: string | null = null;
  for (const raw of text.slice(offset).split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, "");
    const start = offset;
    offset += raw.length;
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (mark) {
      if (fence === null) fence = mark[1]![0]!;
      else if (mark[1]![0] === fence && line.trim().length === mark[1]!.length) fence = null;
      continue;
    }
    if (fence === null && line.includes("@") && line.includes("[")) inLine(line, start, out);
  }
  return out;
}

function codeSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  const pattern = /(`+)[\s\S]*?\1/g;
  for (let m = pattern.exec(line); m; m = pattern.exec(line)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function inLine(line: string, base: number, out: { start: number; end: number }[]): void {
  const code = codeSpans(line);
  const inCode = (i: number) => code.some(([a, b]) => i >= a && i < b);
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "[" || inCode(i) || line[i - 1] === "\\") {
      i++;
      continue;
    }
    if (line[i + 1] === "[") {
      const end = line.indexOf("]]", i + 2);
      i = end < 0 ? line.length : end + 2;
      continue;
    }
    let depth = 0;
    let close = -1;
    for (let j = i; j < line.length && j - i <= 2000; j++) {
      const c = line[j]!;
      if (c === "\\") j++;
      else if (c === "[") depth++;
      else if (c === "]" && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close < 0) {
      i++;
      continue;
    }
    if ("([:".includes(line[close + 1] ?? "\0")) {
      i = close + 1;
      continue;
    }
    const group = line.slice(i + 1, close);
    for (let at = group.indexOf("@"); at >= 0; at = group.indexOf("@", at + 1)) {
      if (inCode(i + 1 + at)) continue;
      const before = group[at - 1];
      const dashed = before === "-" && (at < 2 || " ;".includes(group[at - 2]!));
      if (!(before === undefined || before === " " || before === ";" || dashed)) continue;
      const chars = [...group.slice(at + 1)];
      if (!chars[0] || !keyChar(chars[0])) continue;
      let length = chars[0].length;
      for (let k = 1; k < chars.length; k++) {
        if (keyChar(chars[k]!)) length += chars[k]!.length;
        else if (inner(chars[k]!) && chars[k + 1] && keyChar(chars[k + 1]!)) length += chars[k]!.length;
        else break;
      }
      out.push({ start: base + i + 1 + at + 1, end: base + i + 1 + at + 1 + length });
    }
    i = close + 1;
  }
}

/** How many times the text cites `key`. */
export function countOf(text: string, key: string): number {
  return citations(text).filter((c) => text.slice(c.start, c.end) === key).length;
}

/** The text with `to` written for `from` in every citation of it. */
export function renameIn(text: string, from: string, to: string): string {
  let out = "";
  let copied = 0;
  for (const c of citations(text)) {
    if (text.slice(c.start, c.end) !== from) continue;
    out += text.slice(copied, c.start) + to;
    copied = c.end;
  }
  return out + text.slice(copied);
}
