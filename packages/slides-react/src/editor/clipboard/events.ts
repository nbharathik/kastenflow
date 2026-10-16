// The browser's own copy, cut and paste events, on the editor. Ctrl or Cmd with C, X and V make them wherever the focus is in the editor
// (the slide, the filmstrip, a toolbar button, the title bar), carry the data with no permission to ask, and are what the menus of the
// operating system's Edit send as well. Anything that has a clipboard of its own (a field, the text box being written, the outline, the
// images drawer, a dialog) keeps it: the event is left alone there.

import { type ClipboardEvent as ReactClipboardEvent, type RefObject, useEffect } from "react";

import type { CommandContext } from "../commands/types.ts";
import { contentsOf, writeTo } from "./format.ts";
import { pasteContents } from "./paste.ts";
import { placeOf } from "./place.ts";
import { latest, recall, takeInPlace } from "./store.ts";
import { writeCells } from "./table.ts";
import { wordsOf } from "./words.ts";

/**
 * Chromium makes the copy, cut and paste events for a key only when the command is enabled, which for something that is not a text
 * selection or a field is when the page says, by cancelling the `beforecopy`, `beforecut` and `beforepaste` events (React has no
 * props for them). So the editor says so where it has something to copy (the slides of a list, the blocks selected) and always for a
 * paste, and the keys make the events that `copyEvent` and `pasteEvent` answer. Elsewhere the events are left alone.
 */
export function useNativeClipboard(root: RefObject<HTMLElement | null>, context: CommandContext): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const enabling = (kind: "copy" | "cut" | "paste") => (event: Event) => {
      const place = placeOf(event.target, context.ui, context.session);
      if (place === "own") return;
      if (kind !== "paste" && place === "elements" && context.session.state.selection.length === 0) return;
      event.preventDefault();
    };
    const listeners = (["copy", "cut", "paste"] as const).map((kind) => [`before${kind}`, enabling(kind)] as const);
    for (const [type, listener] of listeners) element.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of listeners) element.removeEventListener(type, listener);
    };
  }, [root, context]);
}

/** A copy or a cut of the blocks, the slides or the cells picked in a table, put on the event. Anything it does not take is left to the browser. */
export function copyEvent(event: ReactClipboardEvent<HTMLElement>, context: CommandContext, cut: boolean): void {
  if (event.defaultPrevented) return;
  const place = placeOf(event.target, context.ui, context.session);
  if (place === "own") return;
  const { session } = context;
  if (place === "cells") return copyCells(event, context, cut);
  const clip = place === "slides" ? (cut ? session.slideClipboard.cut() : session.slideClipboard.copy()) : cut ? session.clipboard.cut() : session.clipboard.copy();
  // Nothing selected: nothing to put there, and the browser may copy the words that are picked in a panel.
  if (!clip || !event.clipboardData) return;
  writeTo(event.clipboardData, clip, wordsOf(clip));
  event.preventDefault();
}

/**
 * A copy or a cut of the cells picked in a table: their words as tab separated text, and as a table in HTML that carries their own words and
 * looks. It is no copy of blocks, so the blocks this window last copied are left as they were. A cut empties the cells once they are on the event.
 */
function copyCells(event: ReactClipboardEvent<HTMLElement>, context: CommandContext, cut: boolean): void {
  const texts = context.session.tables.copy();
  if (!texts || !event.clipboardData) return;
  writeCells(event.clipboardData, texts);
  event.preventDefault();
  if (cut) context.session.tables.clear();
}

/** A paste: what Kasten copied, a picture, or words, where the pointer is; cells, when cells of a table are picked. */
export function pasteEvent(event: ReactClipboardEvent<HTMLElement>, context: CommandContext): void {
  if (event.defaultPrevented) return;
  if (placeOf(event.target, context.ui, context.session) === "own") return;
  const read = contentsOf(event.clipboardData);
  // A webview that keeps only the words: what this window last copied, when the words are the same.
  let contents = read.clip ? read : { ...read, clip: recall(read.text) };
  // Nothing the event carries is readable: what was last copied here.
  if (!contents.clip && contents.text === "" && contents.html === "" && contents.files.length === 0) contents = { ...contents, clip: latest() };
  event.preventDefault();
  const inPlace = takeInPlace();
  void pasteContents(context, contents, { inPlace });
}

/**
 * A browser event of the clipboard that did not come through React (a listener on the window, for keys that fall on the page), shaped as
 * `copyEvent` and `pasteEvent` read it. `target` is the place it is meant for, where the event's own is the page.
 */
const reactOf = (event: ClipboardEvent, target: HTMLElement | null): ReactClipboardEvent<HTMLElement> =>
  ({ defaultPrevented: event.defaultPrevented, target: target ?? event.target, clipboardData: event.clipboardData, preventDefault: () => event.preventDefault() }) as unknown as ReactClipboardEvent<HTMLElement>;

/** `copyEvent` for a browser event of the clipboard: a copy (or a cut) on `target`. */
export function copyNative(event: ClipboardEvent, context: CommandContext, cut: boolean, target: HTMLElement | null = null): void {
  copyEvent(reactOf(event, target), context, cut);
}

/** `pasteEvent` for a browser event of the clipboard: a paste on `target`. */
export function pasteNative(event: ClipboardEvent, context: CommandContext, target: HTMLElement | null = null): void {
  pasteEvent(reactOf(event, target), context);
}
