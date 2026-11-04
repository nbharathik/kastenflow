// Words for comments: when one was written, and what it is about.

import type { DeckComment, Slide } from "@kasten-slides/wasm";

import { labelOf } from "../panels/steps/model.ts";

/** When a comment was written, for a person: "Nov 2, 2026, 9:30 AM", or nothing when the host gave no time. */
export function whenText(created: string): string {
  if (created === "") return "";
  const date = new Date(created);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** What a comment is about: "the slide", an element by name or words, "a spot on the slide", or an element that is gone. */
export function aboutText(slide: Slide, comment: DeckComment): string {
  if (comment.element) {
    const found = findElement(slide, comment.element);
    return found ? labelOf(found) : "an element that is gone";
  }
  return comment.pin ? "a spot on the slide" : "the slide";
}

function findElement(slide: Slide, id: string): Slide["elements"][number] | undefined {
  const visit = (list: Slide["elements"]): Slide["elements"][number] | undefined => {
    for (const element of list) {
      if (element.id === id) return element;
      if (element.type === "group") {
        const inside = visit(element.children);
        if (inside) return inside;
      }
    }
    return undefined;
  };
  return visit(slide.elements);
}

/** Whether a comment's element is still on the slide (or it is not about an element at all). */
export function pinnedToSomething(slide: Slide, comment: DeckComment): boolean {
  return !comment.element || findElement(slide, comment.element) !== undefined;
}
