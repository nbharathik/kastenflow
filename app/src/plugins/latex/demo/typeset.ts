// A very small "typesetter" for the demo: reads the LaTeX source it is given
// (title, sections, paragraphs, equations, lists) and lays it out as lines on
// pages, so the preview changes with what is typed. It is no TeX: maths is
// shown as plain text, and anything it does not know is left as written.

import { PAGE_HEIGHT, PAGE_WIDTH, makePdf, type Face, type Placed } from "./pdf";

const MARGIN = 72;
const WIDTH = PAGE_WIDTH - 2 * MARGIN;
const TOP = PAGE_HEIGHT - MARGIN;
const BODY = 11;
const LEAD = 15;

/** Plain-text forms of the maths marks a short derivation uses. */
const SYMBOLS: Record<string, string> = {
  pm: "±",
  cdot: "·",
  times: "×",
  neq: "!=",
  leq: "<=",
  geq: ">=",
  ldots: "...",
  dots: "...",
  to: "->",
  infty: "infinity",
  pi: "pi",
  alpha: "alpha",
  beta: "beta",
  lambda: "lambda",
  theta: "theta",
  sum: "sum",
  int: "integral",
};

/** Names of functions that are written out as they are. */
const WORDS = new Set(["sin", "cos", "tan", "log", "ln", "exp", "min", "max", "lim"]);

/** `text` between the braces that start at `from` (which is the opening one), and where they end. */
function group(text: string, from: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { inner: text.slice(from + 1, i), end: i + 1 };
  }
  return { inner: text.slice(from + 1), end: text.length };
}

/** Maths as the plain text a reader would say: fractions, roots, powers, symbols. */
export function plainMath(source: string): string {
  let text = source;
  for (let guard = 0; guard < 40; guard++) {
    const frac = text.indexOf("\\frac{");
    if (frac < 0) break;
    const top = group(text, frac + 5);
    const bottom = text[top.end] === "{" ? group(text, top.end) : { inner: "", end: top.end };
    const one = (s: string) => (/^[\w.]+$/.test(s) ? s : `(${s})`);
    text = `${text.slice(0, frac)}${one(top.inner)}/${one(bottom.inner)}${text.slice(bottom.end)}`;
  }
  for (let guard = 0; guard < 40; guard++) {
    const root = text.indexOf("\\sqrt{");
    if (root < 0) break;
    const inner = group(text, root + 5);
    text = `${text.slice(0, root)}sqrt(${inner.inner})${text.slice(inner.end)}`;
  }
  return text
    .replace(/\\(?:left|right)\b\s*/g, "")
    .replace(/\\q?quad\b/g, "  ")
    .replace(/\\[,;!]/g, " ")
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => SYMBOLS[name] ?? (WORDS.has(name) ? name : ""))
    .replace(/\^2/g, "²")
    .replace(/\^3/g, "³")
    .replace(/\^\{([^}]*)\}/g, "^($1)")
    .replace(/_\{([^}]*)\}/g, "_($1)")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A line of running text: inline maths in plain form, a few commands dropped. */
function inline(text: string): string {
  return text
    .replace(/\$([^$]*)\$/g, (_, math: string) => plainMath(math))
    .replace(/\\(emph|textit|textbf|textrm|texttt)\{([^}]*)\}/g, "$2")
    .replace(/\\(?:cite|ref|label|footnote)\{[^}]*\}/g, "")
    .replace(/~/g, " ")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

/** How wide `text` is, near enough to wrap and centre it. */
const widthOf = (text: string, size: number, face: Face): number => text.length * size * (face === "bold" ? 0.5 : 0.45);

function wrap(text: string, size: number, face: Face, width = WIDTH): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && widthOf(next, size, face) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

class Page {
  readonly pages: Placed[][] = [[]];
  y = TOP;

  gap(points: number): void {
    this.y -= points;
  }

  /** Puts a line down, on a new page when this one is full. */
  put(text: string, face: Face, size: number, how: "left" | "center" | "indent" | "right" = "left", lead = LEAD): void {
    if (this.y - lead < MARGIN) {
      this.pages.push([]);
      this.y = TOP;
    }
    const width = widthOf(text, size, face);
    const x = how === "center" ? (PAGE_WIDTH - width) / 2 : how === "indent" ? MARGIN + 18 : how === "right" ? PAGE_WIDTH - MARGIN - width : MARGIN;
    this.y -= lead;
    this.pages[this.pages.length - 1]!.push({ text, face, size, x, y: this.y });
  }

  paragraph(text: string, how: "left" | "indent" = "left"): void {
    for (const line of wrap(text, BODY, "roman", how === "indent" ? WIDTH - 18 : WIDTH)) this.put(line, "roman", BODY, how);
    this.gap(4);
  }
}

const meta = (source: string, name: string): string => {
  const at = source.indexOf(`\\${name}{`);
  return at < 0 ? "" : inline(group(source, at + name.length + 1).inner);
};

/** The pages a LaTeX source makes, as placed lines. */
export function typeset(source: string): Placed[][] {
  const text = source.replace(/(^|[^\\])%.*$/gm, "$1");
  const body = text.includes("\\begin{document}") ? text.slice(text.indexOf("\\begin{document}") + 16).split("\\end{document}")[0]! : text;
  const page = new Page();
  let section = 0;
  let sub = 0;
  let equation = 0;
  let mode: "text" | "math" | "abstract" | "list" = "text";
  let math: string[] = [];
  let item = 0;
  let numbered = false;
  let prose: string[] = [];
  const flush = () => {
    if (prose.length > 0) page.paragraph(inline(prose.join(" ")), mode === "abstract" ? "indent" : "left");
    prose = [];
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (mode === "math") {
      if (/^\\end\{(equation|align)\*?\}|^\\\]|^\$\$$/.test(line)) {
        const shown = plainMath(math.join(" "));
        page.gap(2);
        page.put(shown, "italic", BODY + 1, "center");
        if (!/^\\\]|^\$\$/.test(line) && !/\*/.test(line)) {
          equation++;
          page.y += LEAD;
          page.put(`(${equation})`, "roman", BODY, "right");
        }
        page.gap(6);
        math = [];
        mode = "text";
      } else math.push(line.replace(/&/g, "").replace(/\\\\/g, " "));
      continue;
    }
    if (line === "\\maketitle") {
      flush();
      const title = meta(source, "title");
      page.gap(24);
      for (const t of wrap(title, 20, "bold", WIDTH)) page.put(t, "bold", 20, "center", 26);
      page.gap(8);
      const author = meta(source, "author");
      if (author) page.put(author, "roman", 13, "center", 18);
      const date = meta(source, "date");
      if (date) page.put(date, "roman", 12, "center", 16);
      page.gap(18);
      continue;
    }
    const heading = /^\\(sub)?section\*?\{(.*)\}\s*$/.exec(line);
    if (heading) {
      flush();
      if (heading[1]) sub++;
      else {
        section++;
        sub = 0;
      }
      const label = heading[1] ? `${section}.${sub}` : `${section}`;
      page.gap(10);
      page.put(`${label}   ${inline(heading[2]!)}`, "bold", heading[1] ? 12 : 14, "left", heading[1] ? 17 : 20);
      page.gap(2);
      continue;
    }
    if (/^\\begin\{(equation|align)\*?\}|^\\\[|^\$\$$/.test(line)) {
      flush();
      mode = "math";
      continue;
    }
    if (/^\\begin\{abstract\}/.test(line)) {
      flush();
      page.put("Abstract", "bold", 11, "center", 18);
      mode = "abstract";
      continue;
    }
    if (/^\\end\{abstract\}/.test(line)) {
      flush();
      mode = "text";
      page.gap(8);
      continue;
    }
    if (/^\\begin\{(itemize|enumerate)\}/.test(line)) {
      flush();
      numbered = line.includes("enumerate");
      item = 0;
      mode = "list";
      continue;
    }
    if (/^\\end\{(itemize|enumerate)\}/.test(line)) {
      flush();
      mode = "text";
      page.gap(4);
      continue;
    }
    if (mode === "list" && line.startsWith("\\item")) {
      flush();
      item++;
      prose = [`${numbered ? `${item}.` : "•"}  ${line.slice(5).trim()}`];
      continue;
    }
    if (line === "") flush();
    else if (!line.startsWith("\\") || /^\\(emph|textit|textbf)/.test(line)) prose.push(line);
  }
  flush();
  return page.pages;
}

/** The PDF a LaTeX source builds into. */
export const build = (source: string): Uint8Array => makePdf(typeset(source));
