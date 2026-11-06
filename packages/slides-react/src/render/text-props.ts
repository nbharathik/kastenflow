// What the renderer asks of the text module, and the one place it does so.

import type { Text } from "@kasten-slides/wasm";

import type { TextBlockProps, TextFields } from "../text/TextBlock.tsx";

export type { TextFields };

/**
 * The props `TextBlock` takes besides theme, text, baseStyle, width and
 * height. The renderer passes them as one object, so this is the whole of
 * what it asks of the text module beyond the words.
 */
export type TextBlockExtras = Pick<TextBlockProps, "insets" | "valign" | "fields" | "step" | "emptyPrompt">;

/** Whether a text shows nothing: no run has a visible character, and none stands for a field. */
export function isBlankText(text: Text | null | undefined): boolean {
  if (!text) return true;
  return text.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.field == null && run.t.trim() === ""));
}

/** The same text with every run bold, for the header row of a table. */
export function boldText(text: Text): Text {
  return { ...text, paragraphs: text.paragraphs.map((paragraph) => ({ ...paragraph, runs: paragraph.runs.map((run) => ({ ...run, b: true })) })) };
}

/** The same text, bold when asked and in `color` in the runs that name none of their own: a table style's header over a dark fill. */
export function dressedText(text: Text, bold: boolean, color: string | undefined): Text {
  if (!bold && !color) return text;
  return {
    ...text,
    paragraphs: text.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({ ...run, ...(bold ? { b: true } : {}), ...(color && !run.color ? { color } : {}) })),
    })),
  };
}

/** The same text with paragraphs that name no alignment centred, for the label of a connector. */
export function centeredText(text: Text): Text {
  return { ...text, paragraphs: text.paragraphs.map((paragraph) => ({ ...paragraph, align: paragraph.align ?? "center" })) };
}
