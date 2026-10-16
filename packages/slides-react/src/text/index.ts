// The text module: how words on a slide are drawn, and how they are edited.

export { TextBlock } from "./TextBlock.tsx";
export type { TextBlockProps, TextFields } from "./TextBlock.tsx";
export { FittedTextBlock } from "./FittedTextBlock.tsx";
export { TextEditor } from "./TextEditor.tsx";
export type { CaretAt, CellKeys, FormatState, TextEditorHandle, TextEditorProps, Tri } from "./TextEditor.tsx";
export { docToText, textToDoc } from "./convert.ts";
export { createTextSchema } from "./schema.ts";
export type { TextSchema } from "./schema.ts";
export { SIZE_STEPS, nextSize } from "./sizes.ts";
export { cssText, listNumbers, markerFor, paragraphCss, resolveStyle, runCss } from "./text-style.ts";
export type { ParagraphContext, ResolvedStyle } from "./text-style.ts";
export { BULLET_GLYPHS, DEFAULT_INSETS, DEFAULT_LINE_SPACING, LINE_BREAK, LIST_INDENT, LIST_STEP, MIN_FIT_SCALE } from "./metrics.ts";
export { BULLET_STYLES, NUMBER_STYLES, defaultStyle, glyphOf, kindOfStyle, layoutParagraphs, markerText, markerTexts, styleOf } from "./lists.ts";
export type { Geometry } from "./lists.ts";
export type { CaseMode } from "./case-commands.ts";
export { type TextPrefs, setTextPrefs, subscribeTextPrefs, textPrefs } from "./prefs.ts";
