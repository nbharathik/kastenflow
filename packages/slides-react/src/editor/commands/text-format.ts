// Text formatting beyond the basics: the look of a list and its numbering, line
// and paragraph spacing, how a box fits its words, raised words and capitals,
// change case, and what is corrected as words are typed. Each command works on
// the words selected in the open text box, or on all the words of the selected
// boxes (`format.ts` has the same for bold, size and alignment).

import type { ListKind, ListStyle, Script, TextFit } from "@kasten-slides/wasm";

import type { CaseMode } from "../../text/commands.ts";
import { type TextPrefs, setTextPrefs, textPrefs } from "../../text/prefs.ts";
import type { EditorState } from "../session/types.ts";
import type { TextHandle } from "../text-handle.ts";
import type { UiState } from "../ui-state.ts";
import type { Command, CommandContext } from "./types.ts";
import { canFormat, currentFormat } from "./format.ts";

/** Whether there is text to format: a text box is open, or a box is selected. */
export const live = (state: EditorState, ui: UiState): boolean => ui.text !== null || state.selection.length > 0;

/** The open editor does it, or the selected boxes. */
function each(context: CommandContext, open: (editor: TextHandle) => void, selected: () => void): void {
  const editor = context.ui.state.text;
  if (editor) open(editor);
  else selected();
}

const command = (id: string, label: string, run: Command["run"], more: Partial<Command> = {}): Command => ({ id, label, scope: "global", enabled: live, run, ...more });

// ---- lists

/** The marker styles of the bullets and numbering popover, with the words each is named by. */
export const LIST_STYLES: readonly { style: ListStyle; kind: ListKind; id: string; label: string }[] = [
  { style: "disc", kind: "bullet", id: "disc", label: "Filled circle ●" },
  { style: "circle", kind: "bullet", id: "circle", label: "Open circle ○" },
  { style: "square", kind: "bullet", id: "square", label: "Square ■" },
  { style: "arrow", kind: "bullet", id: "arrow", label: "Arrow ➢" },
  { style: "check", kind: "bullet", id: "check", label: "Check mark ✓" },
  { style: "dash", kind: "bullet", id: "dash", label: "Dash –" },
  { style: "decimal", kind: "number", id: "decimal", label: "Numbers 1. 2. 3." },
  { style: "decimalParen", kind: "number", id: "decimal-paren", label: "Numbers 1) 2) 3)" },
  { style: "lowerAlpha", kind: "number", id: "lower-alpha", label: "Letters a. b. c." },
  { style: "upperAlpha", kind: "number", id: "upper-alpha", label: "Capital letters A. B. C." },
  { style: "lowerRoman", kind: "number", id: "lower-roman", label: "Roman numerals i. ii. iii." },
  { style: "upperRoman", kind: "number", id: "upper-roman", label: "Capital Roman numerals I. II. III." },
];

/** Puts one style of list on the words in hand; null takes the list off. */
export function setListStyle(context: CommandContext, style: ListStyle | null): void {
  each(context, (editor) => editor.setListStyle(style), () => context.session.text.setListStyle(style));
}

export const restartNumbering = (context: CommandContext): void => each(context, (editor) => editor.restartNumbering(), () => context.session.text.restartNumbering());
export const continueList = (context: CommandContext): void => each(context, (editor) => editor.continueList(), () => context.session.text.continueList());
export const setStartNumber = (context: CommandContext, at: number | null): void => each(context, (editor) => editor.setStartNumber(at), () => context.session.text.setStartNumber(at));

/** The size of the markers of the list items in hand as a multiple of their words' size (1.5 is 150%); null is the words' size. */
export const setBulletSize = (context: CommandContext, share: number | null): void => each(context, (editor) => editor.setBulletSize(share), () => context.session.text.setBulletSize(share));

/** The colour of the markers of the list items in hand (a theme colour or `#rrggbb`); null takes the colour of the words. */
export const setBulletColor = (context: CommandContext, color: string | null): void => each(context, (editor) => editor.setBulletColor(color), () => context.session.text.setBulletColor(color));

/** The formatting of the open text box's selection; undefined where no box is open (menus then read it from the selected boxes). */
const open = (ui: UiState) => ui.text?.formatState();

const listCommands: Command[] = [
  command("text.list-none", "No list", (context) => setListStyle(context, null), { checked: (_, ui) => open(ui)?.list === null }),
  ...LIST_STYLES.map(({ style, id, label }) => command(`text.list-${id}`, label, (context) => setListStyle(context, style), { checked: (_, ui) => open(ui)?.listStyle === style })),
  command("text.list-restart", "Restart numbering", restartNumbering),
  command("text.list-continue", "Continue previous list", continueList),
  command("text.bullet-size-reset", "Marker the size of its words", (context) => setBulletSize(context, null)),
  command("text.bullet-color-reset", "Marker the colour of its words", (context) => setBulletColor(context, null)),
];

// ---- spacing

/** The line spacings of the menu, as multiples of the line height. */
export const LINE_SPACINGS = [1, 1.15, 1.5, 2] as const;

/** The space Google Slides adds when it is asked for space before or after a paragraph, in points. */
export const ADDED_SPACE = 10;

export function setLineSpacing(context: CommandContext, multiple: number | null): void {
  each(context, (editor) => editor.setLineSpacing(multiple), () => context.session.text.setLineSpacing(multiple));
}

export function setParagraphSpacing(context: CommandContext, spacing: { before?: number | null; after?: number | null }): void {
  each(context, (editor) => editor.setParagraphSpacing(spacing), () => context.session.text.setParagraphSpacing(spacing));
}

export function setIndents(context: CommandContext, indents: { marginLeft?: number | null; firstLine?: number | null }): void {
  each(context, (editor) => editor.setIndents(indents), () => context.session.text.setIndents(indents));
}

const spacingCommands: Command[] = [
  ...LINE_SPACINGS.map((multiple) =>
    command(`text.line-spacing-${String(multiple).replace(".", "-")}`, `Line spacing ${multiple}`, (context) => setLineSpacing(context, multiple), { checked: (_, ui) => open(ui)?.lineSpacing === multiple }),
  ),
  command("text.line-spacing-default", "Line spacing: the style's own", (context) => setLineSpacing(context, null), { checked: (_, ui) => open(ui)?.lineSpacing === null }),
  command("text.space-before-add", "Add space before paragraph", (context) => setParagraphSpacing(context, { before: ADDED_SPACE })),
  command("text.space-before-remove", "Remove space before paragraph", (context) => setParagraphSpacing(context, { before: 0 })),
  command("text.space-after-add", "Add space after paragraph", (context) => setParagraphSpacing(context, { after: ADDED_SPACE })),
  command("text.space-after-remove", "Remove space after paragraph", (context) => setParagraphSpacing(context, { after: 0 })),
  command("text.paragraph-up", "Move paragraph up", (context) => each(context, (editor) => editor.moveParagraphs(-1), () => context.session.text.moveParagraphs(-1)), { keys: ["Alt+Shift+Up"] }),
  command("text.paragraph-down", "Move paragraph down", (context) => each(context, (editor) => editor.moveParagraphs(1), () => context.session.text.moveParagraphs(1)), { keys: ["Alt+Shift+Down"] }),
];

// ---- fitting

export const FITS: readonly { fit: TextFit; id: string; label: string }[] = [
  { fit: "none", id: "none", label: "Do not autofit" },
  { fit: "shrink", id: "shrink", label: "Shrink text on overflow" },
  { fit: "resize", id: "resize", label: "Resize shape to fit text" },
];

export function setFit(context: CommandContext, fit: TextFit): void {
  each(
    context,
    (editor) => editor.setFit(fit),
    () => void context.session.text.setFit(fit),
  );
}

export function setWrap(context: CommandContext, wrap: boolean): void {
  each(
    context,
    (editor) => editor.setWrap(wrap),
    () => context.session.text.setBox({ wrap }),
  );
}

const fitCommands: Command[] = [
  ...FITS.map(({ fit, id, label }) => command(`text.fit-${id}`, label, (context) => setFit(context, fit), { checked: (_, ui) => open(ui)?.fit === fit })),
  command("text.wrap", "Wrap text", (context) => setWrap(context, !currentFormat(context).wrap), { checked: (_, ui) => open(ui)?.wrap !== false }),
];

// ---- words

export function setScript(context: CommandContext, script: Script | null): void {
  each(context, (editor) => editor.setScript(script), () => context.session.text.setScript(script));
}

const wordCommands: Command[] = [
  command("text.superscript", "Superscript", (context) => setScript(context, "super"), { keys: ["Mod+."], checked: (_, ui) => open(ui)?.script === "super" }),
  command("text.subscript", "Subscript", (context) => setScript(context, "sub"), { keys: ["Mod+,"], checked: (_, ui) => open(ui)?.script === "sub" }),
  command("text.small-caps", "Small capitals", (context) => each(context, (editor) => editor.toggleSmallCaps(), () => context.session.text.toggleMark("smallCaps")), { checked: (_, ui) => open(ui)?.smallCaps === true }),
  command("text.all-caps", "All capitals", (context) => each(context, (editor) => editor.toggleAllCaps(), () => context.session.text.toggleMark("allCaps")), { checked: (_, ui) => open(ui)?.allCaps === true }),
];

export const CASES: readonly { mode: CaseMode; id: string; label: string }[] = [
  { mode: "lower", id: "lower", label: "lowercase" },
  { mode: "upper", id: "upper", label: "UPPERCASE" },
  { mode: "title", id: "title", label: "Title Case" },
  { mode: "sentence", id: "sentence", label: "Sentence case" },
];

export function changeCase(context: CommandContext, mode: CaseMode): void {
  each(context, (editor) => editor.changeCase(mode), () => context.session.text.changeCase(mode));
}

const caseCommands: Command[] = CASES.map(({ mode, id, label }) => command(`text.case-${id}`, label, (context) => changeCase(context, mode)));

// ---- what is corrected as words are typed

const choice = (id: string, label: string, name: keyof TextPrefs): Command => ({
  id,
  label,
  scope: "global",
  checked: () => textPrefs()[name],
  run: () => setTextPrefs({ [name]: !textPrefs()[name] }),
});

const typingCommands: Command[] = [
  choice("text.auto-lists", "Turn `- ` and `1. ` into lists", "autoLists"),
  choice("text.auto-links", "Link web addresses as they are typed", "autoLinks"),
  choice("text.autocorrect", "Replace -- ... (c) -> and :smile: as you type", "autocorrect"),
  choice("text.smart-quotes", "Use curly quotes", "smartQuotes"),
];

export const textFormatCommands: Command[] = [...listCommands, ...spacingCommands, ...fitCommands, ...wordCommands, ...caseCommands, ...typingCommands];

export { canFormat };
