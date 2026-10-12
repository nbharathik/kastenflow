// What a host can ask of an editor from outside: the buttons of a toolbar.
// Each one changes the selected text and hands focus back to the editor.

import type { Align, ListKind, ListStyle, Script, Text, TextFit } from "@kasten-slides/wasm";
import type { EditorView } from "prosemirror-view";

import { indent, moveParagraphs, restartNumbering, setAlign, setBulletColor, setBulletSize, setIndents, setLineSpacing, setList, setParagraphSpacing, setStartNumber, toggleList } from "./block-commands.ts";
import { type CaseMode, changeCase } from "./case-commands.ts";
import type { MountedEditor } from "./editor.ts";
import type { FormatState } from "./format-state.ts";
import { continuePreviousList, applyListStyle } from "./list-commands.ts";
import { linkFromInput } from "./links.ts";
import { type Command, clearFormatting, insertLink, setLink, setValueMark, stepFontSize, toggleFlag, toggleScript } from "./mark-commands.ts";
import { hexOf } from "../theme/index.ts";
import { wholeText } from "./selection-info.ts";

export interface TextEditorHandle {
  focus(): void;
  getText(): Text;
  selectAll(): void;
  formatState(): FormatState;
  toggleBold(): void;
  toggleItalic(): void;
  toggleUnderline(): void;
  toggleStrike(): void;
  toggleCode(): void;
  toggleSmallCaps(): void;
  toggleAllCaps(): void;
  /** Raised or lowered words; switched off when the selection has that one already, and null takes it off. */
  setScript(script: Script | null): void;
  /** Extra space between letters in points (negative tightens); null takes it off. */
  setLetterSpacing(points: number | null): void;
  /** A theme colour (`accent2`) or `#rrggbb`; null takes the colour off, so the text style's own applies. */
  setColor(color: string | null): void;
  /** A size in points; null takes it off. */
  setSize(points: number | null): void;
  /** The next size along the usual list (8, 9, 10 ... 96) up for a positive number, down for a negative one. */
  stepSize(delta: number): void;
  /** A theme font role (`heading`, `body`, `code`) or a family name; null takes it off. */
  setFont(font: string | null): void;
  setAlign(align: Align): void;
  /** The bullet or number button: that list on the selected paragraphs, or off if they all have it. */
  toggleList(kind: ListKind): void;
  /** One style of list (its kind goes with it) on the selected paragraphs; null takes the list off. */
  setListStyle(style: ListStyle | null): void;
  /** "Restart numbering": the first selected numbered item shows 1. */
  restartNumbering(): void;
  /** "Continue previous list": the item goes on from the last numbered item above it. */
  continueList(): void;
  /** Begins the first selected numbered item at this number; null lets it go on from the items above. */
  setStartNumber(at: number | null): void;
  /** The size of the selected items' markers as a multiple of their words' size (1.5 is 150%, kept between 0.25 and 4); null is the words' size. */
  setBulletSize(share: number | null): void;
  /** The colour of the selected items' markers, a theme colour or `#rrggbb`; null takes the colour of the words. */
  setBulletColor(color: string | null): void;
  indent(delta: 1 | -1): void;
  /** Where the selected paragraphs set their lines, in slide units; null for either goes back to what the list or level says. */
  setIndents(indents: { marginLeft?: number | null; firstLine?: number | null }): void;
  /** The selected paragraphs change places with the one above (-1) or below (1). */
  moveParagraphs(delta: 1 | -1): void;
  /** A multiple of the line height, such as 1.15; null for the text style's own. */
  setLineSpacing(multiple: number | null): void;
  /** Points of space before and after the selected paragraphs; null leaves it to the text style. */
  setParagraphSpacing(spacing: { before?: number | null; after?: number | null }): void;
  /** What the box does when the words do not fit it. */
  setFit(fit: TextFit): void;
  /** Whether lines wrap at the box's edge. */
  setWrap(wrap: boolean): void;
  /** An address for the selected text, or the link the caret is in; null takes the link off. A bare `example.com` becomes a web address; an address that must not be followed is refused. */
  setLink(href: string | null): void;
  clearFormatting(): void;
  /** Puts these words in as a link: in place of the selection, or of the link the caret is in, or at the caret. */
  insertLink(words: string, href: string): void;
  /** Asks the host for an address, as Mod-k does: `onLinkRequest` is called with the link the selection is in. */
  requestLink(): void;
  /** The words selected, with a line break between paragraphs. */
  selectedText(): string;
  /** Where the caret is in the window (the end of a selection), or null when there is no editor. */
  caretRect(): { left: number; top: number; right: number; bottom: number } | null;
  /** Capitals, lower case, each word capitalised, or a capital at the start of each sentence: the selection, or the word at the caret. */
  changeCase(mode: CaseMode): void;
  /** Types text where the selection is. */
  insertText(text: string): void;
}

/** What nothing selected looks like: no overrides, left aligned. */
export const PLAIN_FORMAT: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  color: null,
  size: null,
  font: null,
  align: "left",
  list: null,
  level: 0,
  link: null,
  lineSpacing: null,
  script: null,
  smallCaps: false,
  allCaps: false,
  spacing: null,
  listStyle: null,
  start: null,
  bulletColor: null,
  bulletSize: null,
  spaceBefore: null,
  spaceAfter: null,
  marginLeft: 0,
  indent: 0,
  fit: "none",
  wrap: true,
};

/** The views of the handles made here, for tests to reach into. */
const views = new WeakMap<TextEditorHandle, () => EditorView | null>();

/** The view behind a handle. For tests. */
export function viewOfHandle(handle: TextEditorHandle): EditorView | null {
  return views.get(handle)?.() ?? null;
}

/**
 * A handle on whatever editor `current` returns. Before the editor exists and
 * after it is gone the handle does nothing, and reads the text `fallback` gives.
 */
export function createHandle(current: () => MountedEditor | null, fallback: () => Text, boxFields: (change: Pick<Text, "fit" | "wrap">) => void = () => undefined, asked: () => void = () => undefined): TextEditorHandle {
  const run = (command: Command): void => {
    const editor = current();
    if (!editor) return;
    const { view } = editor;
    command(view.state, (tr) => view.dispatch(tr));
    view.focus();
  };
  /** Runs a command made for the editor's context. */
  const withContext = (make: (editor: MountedEditor) => Command): void => {
    const editor = current();
    if (editor) run(make(editor));
  };

  const handle: TextEditorHandle = {
    focus: () => current()?.view.focus(),
    getText: () => current()?.getText() ?? fallback(),
    selectAll() {
      const view = current()?.view;
      if (!view) return;
      view.dispatch(view.state.tr.setSelection(wholeText(view.state)));
      view.focus();
    },
    formatState: () => current()?.formatState() ?? PLAIN_FORMAT,
    toggleBold: () => withContext((e) => toggleFlag("bold", e.ctx)),
    toggleItalic: () => withContext((e) => toggleFlag("italic", e.ctx)),
    toggleUnderline: () => withContext((e) => toggleFlag("underline", e.ctx)),
    toggleStrike: () => withContext((e) => toggleFlag("strike", e.ctx)),
    toggleCode: () => withContext((e) => toggleFlag("code", e.ctx)),
    toggleSmallCaps: () => withContext((e) => toggleFlag("smallCaps", e.ctx)),
    toggleAllCaps: () => withContext((e) => toggleFlag("allCaps", e.ctx)),
    setScript(script) {
      if (script === null) run(setValueMark("script", null));
      else withContext((e) => toggleScript(script, e.ctx));
    },
    setLetterSpacing(points) {
      if (points === null || points === 0) run(setValueMark("spacing", null));
      else if (Number.isFinite(points)) run(setValueMark("spacing", Math.max(-20, Math.min(100, Math.round(points * 100) / 100))));
    },
    setColor(color) {
      const editor = current();
      if (!editor) return;
      if (color === null) run(setValueMark("color", null));
      else if (hexOf(editor.ctx.theme, color) !== null) run(setValueMark("color", color));
    },
    setSize(points) {
      if (points === null) run(setValueMark("size", null));
      else if (Number.isFinite(points) && points > 0) run(setValueMark("size", Math.min(999, Math.round(points * 100) / 100)));
    },
    stepSize(delta) {
      const editor = current();
      if (editor && Number.isFinite(delta)) run(stepFontSize(delta, editor.ctx));
    },
    setFont(font) {
      const name = font?.trim();
      run(setValueMark("font", name ? name : null));
    },
    setAlign: (align) => run(setAlign(align)),
    toggleList: (kind) => withContext((e) => toggleList(kind, e.ctx)),
    setListStyle: (style) => withContext((e) => (style === null ? setList(null, e.ctx) : applyListStyle(style, e.ctx))),
    restartNumbering: () => run(restartNumbering),
    continueList: () => run(continuePreviousList),
    setStartNumber: (at) => run(setStartNumber(at)),
    setBulletSize: (share) => run(setBulletSize(share)),
    setBulletColor(color) {
      const editor = current();
      if (!editor) return;
      if (color === null) run(setBulletColor(null));
      else if (hexOf(editor.ctx.theme, color) !== null) run(setBulletColor(color));
    },
    indent: (delta) => run(indent(delta)),
    setIndents: (indents) => run(setIndents(indents)),
    moveParagraphs: (delta) => run(moveParagraphs(delta)),
    setLineSpacing(multiple) {
      if (multiple === null) run(setLineSpacing(null));
      else if (Number.isFinite(multiple) && multiple > 0) run(setLineSpacing(multiple));
    },
    setParagraphSpacing: (spacing) => run(setParagraphSpacing(spacing)),
    setFit: (fit) => boxFields({ fit }),
    setWrap: (wrap) => boxFields({ wrap }),
    setLink(href) {
      if (href === null) return run(setLink(null));
      const address = linkFromInput(href);
      if (address !== null) run(setLink(address));
    },
    clearFormatting: () => run(clearFormatting),
    insertLink(words, href) {
      const address = linkFromInput(href);
      if (address !== null) run(insertLink(words, address));
    },
    requestLink: () => asked(),
    selectedText() {
      const view = current()?.view;
      if (!view) return "";
      const { from, to } = view.state.selection;
      return view.state.doc.textBetween(from, to, "\n", "\n");
    },
    caretRect() {
      const view = current()?.view;
      if (!view) return null;
      try {
        const { left, top, right, bottom } = view.coordsAtPos(view.state.selection.head);
        return { left, top, right, bottom };
      } catch {
        return null;
      }
    },
    changeCase: (mode) => run(changeCase(mode)),
    insertText(text) {
      const view = current()?.view;
      if (!view || text === "") return;
      view.dispatch(view.state.tr.insertText(text));
      view.focus();
    },
  };
  views.set(handle, () => current()?.view ?? null);
  return handle;
}
