// Pasting a web address.
//
// Over selected text it links that text to it, as in Notion. On an empty
// line, or inside a line of text, it goes in as a plain link and a small menu
// opens: Link keeps it (so does Esc), Bookmark (on an empty line) or Mention
// (in text) turns it into `[Title](address)` with the title of the web page,
// which is read only then. Anything else pastes as it always does.

import type { Ctx } from "@milkdown/kit/ctx";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { linksOf } from "./links";
import { pastedKey, type PastedLink } from "./paste-link-key";
import { openPasteMenu } from "./paste-link-menu";

/** A single http(s) or mailto address and nothing else. */
const ADDRESS = /^(?:https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+)$/i;
const WEB = /^https?:\/\//i;

export function linkSelection(view: EditorView, text: string): boolean {
  const url = text.trim();
  const { state } = view;
  const { from, to, empty, $from, $to } = state.selection;
  const link = state.schema.marks.link;
  if (empty || !link || !ADDRESS.test(url) || !$from.sameParent($to) || !$from.parent.isTextblock) return false;
  if (!$from.parent.type.allowsMarkType(link)) return false;
  view.dispatch(state.tr.addMark(from, to, link.create({ href: url })).scrollIntoView());
  return true;
}

let counter = 0;

/** Whether a line of its own is where the link went: an empty paragraph among the page's blocks, which a bookmark can fill. */
function onEmptyLine(view: EditorView): boolean {
  const { $from } = view.state.selection;
  const container = $from.depth === 1 || ["toggle", "callout"].includes($from.node($from.depth - 1).type.name);
  return $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && container;
}

/** Pastes a web address at the caret as a plain link and offers to make it a bookmark or a mention; false when it is not one to offer. */
export function pasteAddress(view: EditorView, ctx: Ctx, text: string): boolean {
  const url = text.trim();
  const { state } = view;
  const { $from, empty } = state.selection;
  const link = state.schema.marks.link;
  if (!empty || !link || !WEB.test(url) || !ADDRESS.test(url) || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  if (!$from.parent.type.allowsMarkType(link) || $from.marks().some((mark) => mark.type === link)) return false;
  const bookmark = onEmptyLine(view);
  const from = $from.pos;
  const pasted: PastedLink = { id: ++counter, from, to: from + url.length, url };
  view.dispatch(state.tr.insert(from, state.schema.text(url, [link.create({ href: url })])).setMeta(pastedKey, pasted).scrollIntoView());
  openPasteMenu(view, linksOf(ctx), pasted.id, bookmark ? "bookmark" : "mention");
  return true;
}

export const pasteLink = $prose(
  (ctx) =>
    new Plugin<PastedLink | null>({
      key: pastedKey,
      state: {
        init: () => null,
        apply(tr, pasted) {
          const meta = tr.getMeta(pastedKey) as PastedLink | null | undefined;
          if (meta !== undefined) return meta;
          if (!pasted || !tr.docChanged) return pasted;
          // It follows the edits around it, and is forgotten when its text is touched.
          const from = tr.mapping.mapResult(pasted.from, 1);
          const to = tr.mapping.mapResult(pasted.to, -1);
          return from.deleted || to.deleted || to.pos - from.pos !== pasted.to - pasted.from ? null : { ...pasted, from: from.pos, to: to.pos };
        },
      },
      props: {
        // Before the clipboard plugin, which would paste the address as text.
        handleDOMEvents: {
          paste(view, event) {
            if (!view.editable || event.clipboardData?.files.length) return false;
            const text = event.clipboardData?.getData("text/plain") ?? "";
            if (!linkSelection(view, text) && !pasteAddress(view, ctx, text)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);
