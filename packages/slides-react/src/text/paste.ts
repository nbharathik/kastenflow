// Paste. Text from another box of this editor is put back as it was, by
// ProseMirror. Anything else keeps its paragraphs, lists, bold, italic,
// underline, strike and links, and takes the font, colour and size of where
// it lands; plain text becomes a paragraph for each line.

import type { Theme } from "@kasten-slides/wasm";
import { type Mark, Fragment, Slice } from "prosemirror-model";
import { type EditorState, Plugin } from "prosemirror-state";

import { hexOf } from "../theme/index.ts";
import { safeLink } from "./links.ts";

import { markFor } from "./convert.ts";
import { sizeAtStart } from "./mark-commands.ts";
import { type PastedParagraph, type PastedRun, hasWords, parseHtml, parseText, parseTextWithLists, sizesFor } from "./paste-html.ts";
import { attrsOf, type TextSchema } from "./schema.ts";
import { type EditorContext, marksAtStart, selectedParagraphs } from "./selection-info.ts";

/** What pasted words take from the caret. From HTML only the font, colour and size; plain text takes all of it. */
const FROM_CARET_HTML = new Set(["color", "size", "font", "extra"]);

function marksFor(schema: TextSchema, run: PastedRun, caret: readonly Mark[], mode: "html" | "text", sized: (run: PastedRun) => number | null, theme: Theme | undefined): Mark[] {
  let set: readonly Mark[] = [];
  for (const mark of caret) {
    if (mode === "html" ? FROM_CARET_HTML.has(mark.type.name) : mark.type.name !== "field") set = mark.addToSet(set);
  }
  const add = (mark: Mark): void => {
    set = mark.addToSet(set);
  };
  if (run.bold) add(markFor(schema, { name: "bold" }));
  if (run.italic) add(markFor(schema, { name: "italic" }));
  if (run.underline) add(markFor(schema, { name: "underline" }));
  if (run.strike) add(markFor(schema, { name: "strike" }));
  if (run.link) add(markFor(schema, { name: "link", value: run.link }));
  if (mode === "html") {
    if (run.code) add(markFor(schema, { name: "code" }));
    if (run.script) add(markFor(schema, { name: "script", value: run.script }));
    // A colour that is a choice of the page it came from, and a size in proportion to the page's body size.
    if (run.color && theme && hexOf(theme, run.color) !== null) add(markFor(schema, { name: "color", value: run.color }));
    const size = sized(run);
    if (size !== null) add(markFor(schema, { name: "size", value: size }));
  }
  return [...set];
}

/**
 * The slice to put where the selection is. The pasted paragraphs are set like
 * the one they go into, so a list goes on, except where they bring a list of
 * their own. They run into the words before and after the caret, unless the
 * caret is in an empty paragraph and there is more than a line to put in.
 * With `ctx`, colours and sizes of what is pasted from a page are kept, the
 * sizes in proportion to the size at the caret.
 */
export function pasteSlice(paragraphs: readonly PastedParagraph[], state: EditorState, mode: "html" | "text", ctx?: EditorContext): Slice | null {
  const schema = state.schema as TextSchema;
  const target = selectedParagraphs(state)[0]?.node;
  if (paragraphs.length === 0 || !schema.nodes.paragraph) return null;
  const targetAttrs = target ? attrsOf(target) : {};
  const caret = marksAtStart(state);
  const sized = ctx ? sizesFor(paragraphs, sizeAtStart(state, ctx)) : () => null;
  const nodes = paragraphs.map((paragraph) => {
    const own = paragraph.list ? { list: paragraph.list, level: paragraph.level === 0 ? null : paragraph.level, listStyle: paragraph.listStyle ?? null, start: paragraph.start ?? null, marginLeft: null, indent: null } : {};
    const attrs = { ...targetAttrs, ...own, ...(paragraph.list ? {} : { start: null }) };
    const texts = paragraph.runs.filter((run) => run.text !== "").map((run) => schema.text(run.text, marksFor(schema, run, caret, mode, sized, ctx?.theme)));
    return schema.nodes.paragraph.create(attrs, Fragment.fromArray(texts));
  });
  const intoEmpty = state.selection.empty && target?.content.size === 0;
  const open = intoEmpty && (nodes.length > 1 || paragraphs[0]?.list) ? 0 : 1;
  return new Slice(Fragment.fromArray(nodes), open, open);
}

export function pastePlugin(ctx?: EditorContext): Plugin {
  let plainPaste = false;
  return new Plugin({
    props: {
      handleDOMEvents: {
        // Mod-Shift-v pastes plain text.
        keydown: (_view, event) => {
          plainPaste = event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
          return false;
        },
      },
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        const html = data.getData("text/html");
        const text = data.getData("text/plain");
        // Put back what was copied from a box of this editor.
        if (html.includes("data-pm-slice")) return false;
        const wantPlain = plainPaste;
        plainPaste = false;
        const fromHtml = html !== "" && !wantPlain ? parseHtml(html) : [];
        const useHtml = hasWords(fromHtml);
        if (!useHtml && text === "") return false;
        // A list written out in plain text (`- one`, `1. two`) is pasted as a list, but not when plain text was asked for.
        const slice = pasteSlice(useHtml ? fromHtml : wantPlain ? parseText(text) : parseTextWithLists(text), view.state, useHtml ? "html" : "text", ctx);
        if (!slice) return false;
        view.dispatch(view.state.tr.replaceSelection(slice).setMeta("paste", true).setMeta("uiEvent", "paste"));
        return true;
      },
    },
  });
}

/**
 * Makes text copied from a box of this editor safe to put into another: a link
 * that must not be followed, or a colour the format does not know, is taken
 * off, leaving its words. (Text from anywhere else is read by `parseHtml`, which
 * keeps only such links to begin with.)
 */
export function sanitizeCopiedHtml(html: string, theme: Theme): string {
  if (!html.includes("data-ks")) return html;
  const page = new DOMParser().parseFromString(html, "text/html");
  const unwrap = (element: Element): void => element.replaceWith(...Array.from(element.childNodes));
  for (const link of Array.from(page.querySelectorAll('[data-ks="link"]'))) if (safeLink(link.getAttribute("data-v")) === null) unwrap(link);
  for (const color of Array.from(page.querySelectorAll('[data-ks="color"]'))) if (hexOf(theme, color.getAttribute("data-v") ?? "") === null) unwrap(color);
  return page.body.innerHTML;
}
