// A very large paste of plain text (a log, a whole file) goes in a piece at a
// time, with the window free between pieces, so that it never holds the page
// for long: typing, scrolling and the cursor keep answering while it lands.
// Each piece goes through the same paste path as a small one (the clipboard's
// Markdown reading), and the cut falls on a blank line outside a code fence so
// that no block is split.

import type { Ctx } from "@milkdown/kit/ctx";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** A paste longer than this many characters goes in pieces. */
export const BIG_PASTE_CHARS = 100_000;
/** The size a piece aims for. */
export const PIECE_CHARS = 20_000;

const FENCE = /^\s*(```|~~~)/;

/** `text` cut into pieces of about `size` characters, each ending at a blank
 * line that is not inside a code fence (or at a line's end after four times
 * `size` without one; a code fence is never cut). Joined again they are the text. */
export function piecesOf(text: string, size = PIECE_CHARS): string[] {
  const pieces: string[] = [];
  let start = 0;
  let fenced = false;
  let at = 0;
  while (at < text.length) {
    let end = text.indexOf("\n", at);
    end = end < 0 ? text.length : end + 1;
    const line = text.slice(at, end);
    if (FENCE.test(line)) fenced = !fenced;
    at = end;
    // A cut after an empty line once the piece is big enough, or at any line's end when no empty line came
    // (a log has none): a piece must not grow without end.
    if (!fenced && ((at - start >= size && line.trim() === "") || at - start >= size * 4)) {
      pieces.push(text.slice(start, at));
      start = at;
    }
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

/** The window's next turn: whatever it has waiting (keys, scrolling, painting) runs first. */
const nextTurn = () => new Promise<void>((done) => setTimeout(done, 0));

/** Pastes `text` into `view` a piece at a time; resolves when all is in or the page is gone. */
export async function pasteInPieces(view: EditorView, text: string, turn: () => Promise<void> = nextTurn): Promise<void> {
  const pieces = piecesOf(text);
  for (let i = 0; i < pieces.length; i++) {
    if (view.isDestroyed) return;
    view.pasteText(pieces[i]!);
    if (i < pieces.length - 1) await turn();
  }
}

const key = new PluginKey("KASTEN_PASTE_BIG");

export const pasteBig = $prose(
  (_ctx: Ctx) =>
    new Plugin({
      key,
      props: {
        handleDOMEvents: {
          paste(view, event) {
            if (!view.editable) return false;
            const data = event.clipboardData;
            // Only plain text: a paste with files or HTML has its own readers.
            if (!data || data.files.length > 0 || data.getData("text/html")) return false;
            const text = data.getData("text/plain");
            if (text.length <= BIG_PASTE_CHARS) return false;
            event.preventDefault();
            void pasteInPieces(view, text);
            return true;
          },
        },
      },
    }),
);
