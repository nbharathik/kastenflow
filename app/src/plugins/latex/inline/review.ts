// The inline diff of an inline AI answer. The answer is put in the text at
// once, the new lines marked green and the text it replaced shown struck
// through just before them in red, so the person sees both. Keep makes the
// change plain; Undo puts the old text back. The mark follows the text as it
// is edited meanwhile.

import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface Review {
  /** Where the new text is now. */
  from: number;
  to: number;
  /** What it replaced (empty for an insertion). */
  before: string;
}

export const startReview = StateEffect.define<Review>();
export const endReview = StateEffect.define<null>();

class Removed extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  override eq(other: Removed): boolean {
    return other.text === this.text;
  }
  override toDOM(): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "cm-ai-removed";
    dom.setAttribute("aria-label", "Text this answer replaces");
    dom.textContent = this.text;
    return dom;
  }
}

export const reviewField = StateField.define<Review | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(startReview)) return effect.value;
      if (effect.is(endReview)) return null;
    }
    if (!value || !tr.docChanged) return value;
    const from = tr.changes.mapPos(value.from, 1);
    return { ...value, from, to: Math.max(from, tr.changes.mapPos(value.to, -1)) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (review): DecorationSet => {
      if (!review) return Decoration.none;
      const marks = [];
      if (review.before) marks.push(Decoration.widget({ widget: new Removed(review.before), side: -1, block: true }).range(review.from));
      if (review.to > review.from) marks.push(Decoration.mark({ class: "cm-ai-added" }).range(review.from, review.to));
      return Decoration.set(marks, true);
    }),
});

/** The answer waiting to be kept or undone, if there is one. */
export const reviewOf = (state: EditorState): Review | null => state.field(reviewField, false) ?? null;

/** Puts `text` in place of the range `from`–`to` and marks it for review. */
export function applyAnswer(view: EditorView, from: number, to: number, text: string): void {
  const before = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    effects: [startReview.of({ from, to: from + text.length, before }), EditorView.scrollIntoView(from, { y: "nearest" })],
    userEvent: "input.ai",
  });
}

/** Keeps the change: the marks go and the text stays. */
export function keep(view: EditorView): boolean {
  if (!reviewOf(view.state)) return false;
  view.dispatch({ effects: endReview.of(null) });
  return true;
}

/** Puts the old text back. */
export function undo(view: EditorView): boolean {
  const review = reviewOf(view.state);
  if (!review) return false;
  view.dispatch({
    changes: { from: review.from, to: review.to, insert: review.before },
    selection: { anchor: review.from + review.before.length },
    effects: endReview.of(null),
    userEvent: "undo.ai",
  });
  return true;
}
