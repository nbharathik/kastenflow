// A text as the Markdown a person would write it, for the outline: the way
// back from the stored runs to the dialect `set_text` reads. It writes what
// the engine's own writer writes, so that an outline read here and written
// back changes nothing:
//
//   - a bullet paragraph is `- words`, a numbered one `1. words`, two spaces
//     of indent for each level (five at most);
//   - `# words`, `## words` and `> words` for the title, subtitle and quote
//     styles, and a fence for lines of code;
//   - `**bold**`, `*italic*`, `~~strike~~`, `<u>underline</u>`, `` `code` ``,
//     `$formula$` and `[words](address)` (see inline.ts);
//   - a line break inside a paragraph is a backslash at the end of the line
//     (the lines after it are indented to line up with the words, which the
//     reader ignores).
//
// A paragraph with no words says nothing, unless it is a list item or has a
// style, which stay as their marker alone.

import type { Paragraph, Run, Text } from "@kasten-slides/wasm";

import { listNumbers } from "../../text/lists.ts";
import { guardStart, inlineMarkdown } from "./inline.ts";

export { guardStart, inlineMarkdown } from "./inline.ts";
export type { InlineOptions } from "./inline.ts";

/** The deepest list level; a deeper indent counts as this one. */
export const MAX_LEVEL = 5;
const INDENT = "  ";

const runsOf = (paragraph: Paragraph): Run[] => (Array.isArray(paragraph.runs) ? paragraph.runs : []);
const wordsOf = (paragraph: Paragraph): string => runsOf(paragraph).map((run) => (typeof run.t === "string" ? run.t : "")).join("");
const STYLES: Record<string, string> = { title: "# ", subtitle: "## ", quote: "> " };

/** Lines of code as one fence, longer than any run of backticks inside. */
function fence(lines: readonly Paragraph[]): string {
  const texts = lines.flatMap((paragraph) => wordsOf(paragraph).split("\n"));
  const longest = Math.max(0, ...texts.flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length)));
  const bar = "`".repeat(Math.max(3, longest + 1));
  return `${bar}\n${texts.join("\n")}\n${bar}`;
}

/** One paragraph as a line, or null for one that says nothing. `count` is the number a numbered item shows. */
function paragraphLine(paragraph: Paragraph, count: number | null): string | null {
  const listed = paragraph.list === "bullet" || paragraph.list === "number";
  const style = !listed && paragraph.style && STYLES[paragraph.style] ? paragraph.style : null;
  const level = listed ? Math.min(Math.max(0, Math.floor(Number(paragraph.level) || 0)), MAX_LEVEL) : 0;
  // Space at the ends of a paragraph is not kept by a reader, and it must not hide a marker from the guard.
  const content = inlineMarkdown(runsOf(paragraph), { lineBreak: `\\\n${listed ? INDENT.repeat(level + 1) : ""}` }).trim();
  const empty = content.trim() === "";
  if (empty && !listed && !style) return null;
  let prefix = "";
  if (listed) prefix = `${INDENT.repeat(level)}${paragraph.list === "number" ? `${count ?? 1}. ` : "- "}`;
  else if (style) prefix = STYLES[style]!;
  if (empty) return prefix.trimEnd();
  return prefix === "" ? guardStart(content) : prefix + content;
}

/**
 * A text as Markdown, a line to a paragraph. Numbered paragraphs are counted
 * the way the engine writes them: a run at one level, which a bullet, a plain
 * paragraph or a shallower item starts again. A text that is one empty
 * paragraph, such as a slot nobody has typed into, is nothing at all.
 */
export function textToMarkdown(text: Text): string {
  const paragraphs = Array.isArray(text.paragraphs) ? text.paragraphs : [];
  if (paragraphs.length === 1 && wordsOf(paragraphs[0]!).trim() === "") return "";
  // What each numbered item shows, counted as the engine counts: a bullet, a plain paragraph or a shallower item begins a level again, and an item that names a number begins there.
  const counts = listNumbers(paragraphs);
  const blocks: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!;
    if (paragraph.style === "code") {
      let end = i;
      while (paragraphs[end + 1]?.style === "code") end += 1;
      blocks.push(fence(paragraphs.slice(i, end + 1)));
      i = end;
    } else {
      const line = paragraphLine(paragraph, counts[i] ?? null);
      if (line !== null) blocks.push(line);
    }
  }
  return blocks.join("\n");
}

/** A text as a single line of Markdown, for a title: paragraphs and line breaks run together with a space, and no list marker. */
export function titleMarkdown(text: Text): string {
  const paragraphs = Array.isArray(text.paragraphs) ? text.paragraphs : [];
  const lines = paragraphs.flatMap((paragraph) => {
    const line = inlineMarkdown(runsOf(paragraph), { lineBreak: " " }).trim();
    return line === "" ? [] : [line];
  });
  return guardStart(lines.join(" "));
}
