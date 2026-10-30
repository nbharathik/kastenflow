// A smart page and the chat. "Improve layout" and "Fix its errors" start a chat
// about the open smart page, the way "Fix with AI" does for a LaTeX file. They
// are offered from the smart page's own header and the palette, and only on a
// smart page, so the chat's slash list never shows them on any other page. What
// the chat changes waits in the chat for the person to look at.

import { runInChat } from "../chat/run-action";
import type { Chip } from "../chat/thread";

/** The chip for the smart page at `path`: the chat reads the page and its code itself when the message is sent. */
const pageChip = (path: string, title: string): Chip => ({ kind: "note", label: title, ref: [path] });

/** A chat about the smart page at `path`, asked to improve how it is arranged without changing what it shows. */
export function improveLayout(path: string, title: string): Promise<boolean> {
  return runInChat("improve-smart-layout", [pageChip(path, title)]);
}

/** A chat about the smart page at `path`, asked to fix the errors the page reported and the checks found. */
export function fixErrors(path: string, title: string): Promise<boolean> {
  return runInChat("fix-smart-errors", [pageChip(path, title)]);
}
