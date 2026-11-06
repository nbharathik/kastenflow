// Comments: notes left on a slide, on an element or at a point, answered and settled. Each is one engine operation, so each is one step of
// undo, and nothing is ever removed: a settled comment stays and can be opened again.

import type { DeckComment, Slide } from "@kasten-slides/wasm";

import type { EditorSession } from "./session.ts";

/** A comment with the slide it is on. */
export interface CommentOn {
  slide: Slide;
  /** The slide's place in the deck, from 1. */
  number: number;
  comment: DeckComment;
}

/** What a comment is about besides its slide: an element of it, or a point on it. */
export interface CommentPlace {
  element?: string;
  pin?: { x: number; y: number };
}

/** The time as UTC text, to the second: `2026-11-02T09:30:00Z`. */
export function nowText(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

export class ReviewCommands {
  constructor(private readonly s: EditorSession) {}

  /** The name this editor writes comments under. */
  get author(): string {
    return this.s.host.author?.trim() || "You";
  }

  /** Every comment of the deck, slide by slide, oldest first on a slide. */
  all(): CommentOn[] {
    return this.s.deck.slides.flatMap((slide, i) => (slide.comments ?? []).map((comment) => ({ slide, number: i + 1, comment })));
  }

  /** The comments of one slide. */
  of(slideId: string): readonly DeckComment[] {
    return this.s.deck.slides.find((slide) => slide.id === slideId)?.comments ?? [];
  }

  /** How many comments are open (not settled) in the deck. */
  get open(): number {
    return this.all().filter(({ comment }) => !comment.resolved).length;
  }

  /** Leaves a comment on a slide (the one shown by default). Answers its id, or nothing when it had no words or the engine refused it. */
  add(text: string, place: CommentPlace = {}, slideId: string = this.s.slide.id): string | undefined {
    const words = text.trim();
    if (words === "") return undefined;
    const input = {
      slide: slideId,
      text: words,
      author: this.author,
      at: nowText(),
      ...(place.element ? { element: place.element } : {}),
      ...(place.pin ? { x: place.pin.x, y: place.pin.y } : {}),
    };
    return this.s.run(() => this.s.core.apply("add_deck_comment", input))?.output.comment;
  }

  /** Answers a comment. Answers whether it was written. */
  reply(commentId: string, text: string): boolean {
    const words = text.trim();
    if (words === "") return false;
    return this.s.run(() => this.s.core.apply("reply_deck_comment", { comment: commentId, text: words, author: this.author, at: nowText() })) !== undefined;
  }

  /** Settles a comment, or opens it again. */
  resolve(commentId: string, resolved = true): void {
    this.s.run(() => this.s.core.apply("resolve_deck_comment", { comment: commentId, resolved }));
  }
}
