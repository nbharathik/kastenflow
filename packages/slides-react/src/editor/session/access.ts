// What a slide tells a person who cannot see it, and the fixes the accessibility panel offers. Each is one engine operation: a hidden
// title and the reading order are the slide's own (`set_slide_access`), the rest are changes to an element (`patch_elements`).

import type { Patch } from "./elements.ts";
import type { EditorSession } from "./session.ts";

export class AccessCommands {
  constructor(private readonly s: EditorSession) {}

  /** Gives a slide a title it does not draw; empty words take it away. */
  setTitle(slideId: string, title: string): void {
    this.s.run(() => this.s.core.apply("set_slide_access", { slide: slideId, title: title.trim() }));
  }

  /** Sets the order a slide's elements are read in; an empty list goes back to the usual order. */
  setOrder(slideId: string, ids: readonly string[]): void {
    this.s.run(() => this.s.core.apply("set_slide_access", { slide: slideId, readingOrder: [...ids] }));
  }

  private patch(slideId: string, ids: readonly string[], patch: Patch): void {
    if (ids.length === 0) return;
    this.s.run(() => this.s.core.apply("patch_elements", { slide: slideId, patches: ids.map((id) => ({ id, patch })) }));
  }

  /** Says a picture is decoration, which needs no words (its alt text is empty on purpose); `false` takes that back. */
  markDecorative(slideId: string, ids: readonly string[], on = true): void {
    this.patch(slideId, ids, { alt: on ? "" : null });
  }

  /** What a screen reader says of an element. */
  describe(slideId: string, id: string, words: string): void {
    this.patch(slideId, [id], { alt: words.trim() === "" ? null : words });
  }

  /** Makes the first row of a table its header. */
  makeHeader(slideId: string, id: string): void {
    this.patch(slideId, [id], { headerRow: true });
  }

  /** Gives a video a WebVTT file of captions (a path in the host's store); null takes it away. */
  setCaptions(slideId: string, id: string, path: string | null): void {
    this.patch(slideId, [id], { captions: path });
  }
}
