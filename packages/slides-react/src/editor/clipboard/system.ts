// The system clipboard through the asynchronous API, for what has no event to ride on: the Edit menu and the right-click menus. A key
// press makes a copy, cut or paste event, which carries the data with no permission to ask (`events.ts`); this is the way for a click, and
// it asks the browser for access the first time (a webview may or may not).

import type { Text } from "@kasten-slides/wasm";

import { type Clip, type ClipContents, EMPTY, fromHtml, htmlOf, legacy } from "./format.ts";
import { latest, recall } from "./store.ts";
import { htmlOfCells, rowsOfTexts, tsvOfRows } from "./table.ts";
import { wordsOf } from "./words.ts";

/** Puts HTML and its words on the clipboard; the words alone where only text can be written. */
async function writeBoth(html: string, words: string): Promise<void> {
  const board = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!board) return;
  try {
    if (typeof board.write === "function" && typeof ClipboardItem !== "undefined") {
      await board.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
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

/** Puts a copy on the clipboard: the HTML that carries it, and its words; the words alone where only text can be written. */
export async function writeSystem(clip: Clip): Promise<void> {
  const words = wordsOf(clip);
  await writeBoth(htmlOf(clip, words), words);
}

/** Puts a copy of cells on the clipboard: a table in HTML that carries their words and looks, and their words as tab separated text. */
export async function writeSystemCells(texts: readonly (readonly Text[])[]): Promise<void> {
  await writeBoth(htmlOfCells(texts), tsvOfRows(rowsOfTexts(texts)));
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
