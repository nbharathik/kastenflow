// Copy, cut and paste of the elements on a slide. A copy is a clip (`clipboard/format.ts`): the elements, each with the box it
// occupies, and the slide it came from. The system clipboard is written and read by `clipboard/` (the copy, cut and paste events,
// and the menus); this is what a copy holds and what a paste does to the slide: one operation, so one step of undo.

import type { Element } from "@kasten-slides/wasm";

import { type ElementsClip, legacy, newStamp } from "../clipboard/format.ts";
import { countPaste, latest, recall, remember } from "../clipboard/store.ts";
import { wordsOf } from "../clipboard/words.ts";
import { clickBox } from "../factory.ts";
import type { EditorSession } from "./session.ts";
import type { Box } from "./types.ts";

/** Slide units a copy lands down and right of what it was copied from, and each paste after the first of the same copy further. */
export const STEP = 16;

/** The widest a text box made from pasted words is, and the room left round it. */
const WIDEST = 640;
const MARGIN = 40;

/** A text box's size for these lines of words: wide, and as tall as the lines are likely to run. */
function sizeFor(lines: readonly string[], room: { w: number; h: number }): { w: number; h: number } {
  const w = Math.min(WIDEST, Math.max(room.w - 2 * MARGIN, 80));
  const rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 13) / w)), 0);
  return { w, h: Math.min(Math.max(rows * 36 + 16, 60), Math.max(room.h - 2 * MARGIN, 60)) };
}

export class Clipboard {
  constructor(private readonly s: EditorSession) {}

  /** Whether some copy of elements is held. */
  get hasContent(): boolean {
    return latest()?.kind === "elements";
  }

  /**
   * Copies the elements (the selection, unless some are named). Elements that take their place from the layout are copied with the
   * box they occupy and lose the slot, so they land the same size anywhere. Answers the clip, which is for the caller to put on the
   * system clipboard, or null when there is nothing to copy.
   */
  copy(ids: readonly string[] = this.s.state.selection, options: { cut?: boolean } = {}): ElementsClip | null {
    const picked = this.s.elements.find(ids);
    if (picked.length === 0) return null;
    const elements = picked.map((element) => {
      const box = this.s.elements.boxOf(element);
      const { placeholder: _slot, ...rest } = element;
      return structuredClone(box ? ({ ...rest, ...box } as Element) : (rest as Element));
    });
    const clip: ElementsClip = { v: 2, kind: "elements", stamp: newStamp(), elements, from: this.s.state.slideId, cut: options.cut === true };
    remember(clip, wordsOf(clip));
    return clip;
  }

  /** Copies and then removes. */
  cut(ids: readonly string[] = this.s.state.selection): ElementsClip | null {
    const clip = this.copy(ids, { cut: true });
    if (clip) this.s.elements.remove(ids);
    return clip;
  }

  /**
   * Puts the elements of a copy on the slide shown, on top, and selects them. A paste on the slide they came from is 16 units down and
   * right of them, and each further paste of the same copy 16 more; on another slide, or in another deck, they land where they were
   * (the first time); a cut is put back exactly where it was. `inPlace` keeps the place every time. Resolves to the new ids.
   */
  pasteElements(clip: ElementsClip, options: { inPlace?: boolean } = {}): string[] {
    const slide = this.s.state.slideId;
    const before = countPaste(clip.stamp, slide);
    const steps = options.inPlace ? 0 : before + (clip.from === slide && !clip.cut ? 1 : 0);
    const offset = STEP * steps;
    const done = this.s.run(() => this.s.core.apply("paste_elements", { slide, elements: structuredClone(clip.elements), dx: offset, dy: offset }));
    if (!done) return [];
    this.s.setTool("select");
    this.s.select(done.output.ids);
    return done.output.ids;
  }

  /** A text box with these words, its middle at `at` (the middle of the slide without it) and kept on the slide. Resolves to its id. */
  pasteText(words: string, at?: { x: number; y: number }): string[] {
    const lines = words.replace(/\r\n?/g, "\n").split("\n");
    const room = this.s.deck.size;
    const size = sizeFor(lines, room);
    const box = clickBox(at ?? { x: room.w / 2, y: room.h / 2 }, size);
    const kept: Box = { ...box, x: Math.min(Math.max(box.x, 0), Math.max(room.w - box.w, 0)), y: Math.min(Math.max(box.y, 0), Math.max(room.h - box.h, 0)) };
    const text = { paragraphs: lines.map((line) => ({ runs: [{ t: line }] })), fit: "resize" as const };
    return this.s.elements.insert([{ type: "text", id: "", ...kept, text } as Element]);
  }

  /**
   * Pastes what was copied here (without an argument), or what `source` is: a clip, or plain text, which is a copy of the first
   * versions, or what this editor's last copy wrote, or else words for a new text box.
   */
  paste(source?: ElementsClip | string, options: { inPlace?: boolean; at?: { x: number; y: number } } = {}): string[] {
    const held = latest();
    const clip = typeof source === "object" ? source : source === undefined ? (held?.kind === "elements" ? held : null) : (legacy(source) ?? asElements(recall(source)));
    if (clip) return this.pasteElements(clip, options);
    const words = typeof source === "string" ? source.trim() : "";
    return words ? this.pasteText(words, options.at) : [];
  }
}

const asElements = (clip: ReturnType<typeof recall>): ElementsClip | null => (clip?.kind === "elements" ? clip : null);
