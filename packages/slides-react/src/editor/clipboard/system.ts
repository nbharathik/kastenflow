// The system clipboard through the asynchronous API, for what has no event to ride on: the Edit menu and the right-click menus. A key
// press makes a copy, cut or paste event, which carries the data with no permission to ask (`events.ts`); this is the way for a click, and
// it asks the browser for access the first time (a webview may or may not).

import { type Clip, type ClipContents, EMPTY, fromHtml, htmlOf, legacy } from "./format.ts";
import { latest, recall } from "./store.ts";
import { wordsOf } from "./words.ts";

/** Puts a copy on the clipboard: the HTML that carries it, and its words; the words alone where only text can be written. */
export async function writeSystem(clip: Clip): Promise<void> {
  const words = wordsOf(clip);
  const board = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!board) return;
  try {
    if (typeof board.write === "function" && typeof ClipboardItem !== "undefined") {
      await board.write([
        new ClipboardItem({
          "text/html": new Blob([htmlOf(clip, words)], { type: "text/html" }),
          "text/plain": new Blob([words], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    // Refused, or the browser keeps only some types: the words go as they are.
  }
  await board.writeText?.(words).catch(() => {});
}

/** The picture an item of the clipboard holds, as a file named as a screenshot is: `image.png`. */
const nameOf = (type: string): string => `image.${type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*$/, "") || "png"}`;

/** What the system clipboard holds, as far as the browser lets this page read it; nothing at all when it does not. */
export async function readSystem(): Promise<ClipContents> {
  const board = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!board) return EMPTY;
  let text = "";
  let html = "";
  const files: File[] = [];
  let read = false;
  try {
    for (const item of (await board.read?.()) ?? []) {
      read = true;
      if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
      const picture = item.types.find((type) => type.startsWith("image/"));
      if (picture) files.push(new File([await item.getType(picture)], nameOf(picture), { type: picture }));
    }
  } catch {
    // Not allowed, or not a clipboard that can be read like that: try for the words alone.
  }
  if (!read) text = (await board.readText?.().catch(() => "")) ?? "";
  return { clip: fromHtml(html) ?? legacy(text), text, html, files };
}

/**
 * What a paste has to go on: what the clipboard holds and, when it holds the words that this window's last copy wrote and no more
 * (a webview keeps nothing else), that copy. A clipboard that could not be read gives the last copy there was.
 */
export function withMemory(contents: ClipContents): ClipContents {
  if (contents.clip) return contents;
  const clip = recall(contents.text);
  if (clip) return { ...contents, clip };
  const empty = contents.text === "" && contents.html === "" && contents.files.length === 0;
  return empty ? { ...contents, clip: latest() } : contents;
}
