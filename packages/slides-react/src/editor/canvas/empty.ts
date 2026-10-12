import type { Element } from "@kasten-slides/wasm";

/**
 * Whether the element is a slot of the slide's layout that nothing has been put in: a title or body with no words, a picture
 * with no file. On a slide made from a layout these cover most of the slide, so a press on one is not a press on something:
 * a drag over it is a selection rectangle, and only a click selects it.
 */
export function isEmptyPlaceholder(element: Element | undefined): boolean {
  if (!element?.placeholder) return false;
  if (element.type === "image") return element.src.trim() === "";
  if (element.type === "text") return element.text.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.t.trim() === "" && !run.field));
  return false;
}
