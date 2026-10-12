// The words of what was copied, for the plain text of a copy: what a program that knows nothing of slides gets when the clipboard is
// pasted into it. The text of the blocks, a line to a paragraph; a block with no words says what it is.

import type { Element, Slide } from "@kasten-slides/wasm";

import type { Clip } from "./format.ts";

/** Every paragraph of text found in a value, in the order it is held: the words of a text box, a shape, a table cell, a label. */
function paragraphsIn(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) paragraphsIn(item, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const found = value as { paragraphs?: unknown };
  if (Array.isArray(found.paragraphs)) {
    for (const paragraph of found.paragraphs as { runs?: { t?: unknown }[] }[]) {
      const line = (paragraph.runs ?? []).map((run) => (typeof run.t === "string" ? run.t : "")).join("");
      if (line.trim() !== "") into.push(line);
    }
    return;
  }
  for (const [key, inner] of Object.entries(value)) {
    // Styles, steps and the box hold no words of the block.
    if (key !== "style" && key !== "stepStates") paragraphsIn(inner, into);
  }
}

const KINDS: Record<string, string> = { image: "Picture", shape: "Shape", line: "Line", connector: "Connector", table: "Table", group: "Group", video: "Video", embed: "Embedded content" };

/** The lines of words a block holds; a block with none gives one line naming it. */
export function wordsOfElement(element: Element): string[] {
  const lines: string[] = [];
  if (element.type === "code") return element.code.split("\n");
  paragraphsIn(element, lines);
  if (lines.length > 0) return lines;
  const alt = element.alt?.trim();
  if (alt) return [alt];
  return [KINDS[element.type] ?? "Block"];
}

/** The title of a slide, or nothing. */
function titleOf(slide: Slide): string {
  const title = slide.elements.find((element) => element.placeholder === "title") ?? slide.elements.find((element) => element.type === "text");
  const lines: string[] = [];
  if (title) paragraphsIn(title, lines);
  return lines[0] ?? "";
}

/** The plain text of a copy. */
export function wordsOf(clip: Clip): string {
  if (clip.kind === "elements") return clip.elements.flatMap(wordsOfElement).join("\n");
  return clip.slides.map((slide, i) => titleOf(slide) || `Slide ${i + 1}`).join("\n");
}
