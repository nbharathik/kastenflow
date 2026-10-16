// Text formatting from anywhere: with a text box open the change goes to its
// editor (so it applies to the words selected); with boxes selected it applies
// to all their words.

import type { Align, ListKind } from "@kasten-slides/wasm";

import type { FormatState } from "../session/text-commands.ts";
import type { IconName } from "../ui/icons.ts";
import type { Command, CommandContext } from "./types.ts";

/** The sizes the size box steps through. */
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 72, 96];

/** The colour the Highlight command puts behind words: a marker pen's yellow. */
export const MARKER = "#fff176";

/** How the text in hand looks now: the open editor's selection, else the selected boxes. */
export function currentFormat({ session, ui }: CommandContext): FormatState {
  return (ui.state.text?.formatState() as FormatState | undefined) ?? session.text.state();
}

/** Whether there is any text to format: an open editor, or a selected box that holds text. */
export function canFormat({ session, ui }: CommandContext): boolean {
  return ui.state.text !== null || session.elements.find().some((e) => e.type === "text" || e.type === "shape");
}

export function toggleMark(context: CommandContext, mark: "b" | "i" | "u" | "s" | "code"): void {
  const editor = context.ui.state.text;
  if (editor) {
    ({ b: editor.toggleBold, i: editor.toggleItalic, u: editor.toggleUnderline, s: editor.toggleStrike, code: editor.toggleCode })[mark].call(editor);
  } else if (mark === "code") context.session.text.toggleMark("code");
  else context.session.text.toggle(mark);
}

export function setColor(context: CommandContext, color: string | null): void {
  const editor = context.ui.state.text;
  if (editor) editor.setColor(color);
  else context.session.text.setRun("color", color);
}

/** A colour behind the words, like a marker pen; null takes it away. */
export function setHighlight(context: CommandContext, color: string | null): void {
  const editor = context.ui.state.text;
  if (editor) editor.setHighlight(color);
  else context.session.text.setRun("highlight", color);
}

export function setFont(context: CommandContext, family: string | null): void {
  const editor = context.ui.state.text;
  if (editor) editor.setFont(family);
  else context.session.text.setRun("font", family);
}

export function setSize(context: CommandContext, points: number | null): void {
  const editor = context.ui.state.text;
  if (editor) editor.setSize(points);
  else context.session.text.setRun("size", points);
}

/** Steps the size to the next larger or smaller entry of the size list. */
export function stepSize(context: CommandContext, direction: 1 | -1, styleSize: number): void {
  const editor = context.ui.state.text;
  if (editor) return editor.stepSize(direction);
  const now = currentFormat(context).size;
  const from = typeof now === "number" ? now : styleSize;
  const next = direction > 0 ? SIZES.find((n) => n > from) : [...SIZES].reverse().find((n) => n < from);
  if (next) context.session.text.setRun("size", next);
}

export function setAlign(context: CommandContext, align: Align): void {
  const editor = context.ui.state.text;
  if (editor) editor.setAlign(align);
  else context.session.text.setAlign(align);
}

export function toggleList(context: CommandContext, kind: ListKind): void {
  const editor = context.ui.state.text;
  if (editor) editor.toggleList(kind);
  else context.session.text.toggleList(kind);
}

export function indent(context: CommandContext, delta: 1 | -1): void {
  const editor = context.ui.state.text;
  if (editor) editor.indent(delta);
  else context.session.text.indent(delta);
}

export function setLineSpacing(context: CommandContext, multiple: number | null): void {
  const editor = context.ui.state.text;
  if (editor) editor.setLineSpacing(multiple);
  else context.session.text.setLineSpacing(multiple);
}

export function clearFormatting(context: CommandContext): void {
  const editor = context.ui.state.text;
  if (editor) editor.clearFormatting();
  else context.session.text.clearFormatting();
}

const mark = (id: string, label: string, icon: IconName, key: string, which: "b" | "i" | "u" | "s" | "code"): Command => ({
  id: `text.${id}`,
  label,
  icon,
  keys: [key],
  scope: "global",
  enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
  run: (context) => toggleMark(context, which),
});

const align = (id: string, label: string, icon: IconName, key: string, to: Align): Command => ({
  id: `text.align-${id}`,
  label,
  icon,
  keys: [key],
  scope: "global",
  enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
  run: (context) => setAlign(context, to),
});

export const formatCommands: Command[] = [
  mark("bold", "Bold", "bold", "Mod+B", "b"),
  mark("italic", "Italic", "italic", "Mod+I", "i"),
  mark("underline", "Underline", "underline", "Mod+U", "u"),
  mark("strike", "Strikethrough", "strikethrough", "Mod+Shift+X", "s"),
  mark("code", "Code", "code", "Mod+E", "code"),
  align("left", "Align left", "text-align-start", "Mod+Shift+L", "left"),
  align("center", "Align centre", "text-align-center", "Mod+Shift+E", "center"),
  align("right", "Align right", "text-align-end", "Mod+Shift+R", "right"),
  align("justify", "Justify", "text-align-justify", "Mod+Shift+J", "justify"),
  {
    id: "text.bullets",
    label: "Bulleted list",
    icon: "list",
    keys: ["Mod+Shift+8"],
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: (context) => toggleList(context, "bullet"),
  },
  {
    id: "text.numbers",
    label: "Numbered list",
    icon: "list-ordered",
    keys: ["Mod+Shift+7"],
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: (context) => toggleList(context, "number"),
  },
  {
    id: "text.indent",
    label: "Increase indent",
    icon: "list-indent-increase",
    keys: ["Mod+]"],
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: (context) => indent(context, 1),
  },
  {
    id: "text.outdent",
    label: "Decrease indent",
    icon: "list-indent-decrease",
    keys: ["Mod+["],
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: (context) => indent(context, -1),
  },
  {
    id: "text.clear",
    label: "Clear formatting",
    icon: "remove-formatting",
    keys: ["Mod+\\"],
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: clearFormatting,
  },
  {
    id: "text.highlight",
    label: "Highlight",
    icon: "highlighter",
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    // The marker pen: yellow behind the words, or off when all of them have it already. Another colour is picked in the toolbar.
    run: (context) => setHighlight(context, currentFormat(context).highlight === MARKER ? null : MARKER),
  },
  {
    id: "text.highlight-none",
    label: "Remove highlight",
    icon: "remove-formatting",
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    run: (context) => setHighlight(context, null),
  },
  {
    id: "text.link",
    label: "Insert link…",
    icon: "link",
    keys: ["Mod+K"],
    scope: "global",
    enabled: (s, ui) => ui.text !== null || s.selection.length > 0,
    // While a text box is open the link card opens beside the caret; for boxes that are only selected there is the dialog.
    run: ({ ui }) => (ui.state.text ? ui.state.text.requestLink() : ui.openDialog("link")),
  },
];
