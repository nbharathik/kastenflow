// What a slide holds, in the few kinds a layout cares about: a title, bodies, pictures and the numbers or quotes that have a slot of
// their own. Design ideas are matched against this, never against the words.

import type { Element, Slide } from "@kasten-slides/wasm";

import { kindOfRole } from "../layouts/slots.ts";

const words = (element: Element): boolean => {
  if (element.type === "text") return element.text.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.t.trim() !== ""));
  if (element.type === "image") return element.src.trim() !== "";
  return false;
};

/** What a slide holds. */
export interface Content {
  /** The title, when the slide has one with words. */
  title: Element | undefined;
  /** Text with words that is not the title, in the order of the stack. */
  bodies: Element[];
  /** Pictures, placed in a slot or free. */
  pictures: Element[];
  /** Roles of the slots that hold something (a slot left empty is not used). */
  usedRoles: string[];
  /** Everything else on the slide (shapes, tables, charts ...): ideas leave it where it is. */
  others: Element[];
}

/** The content of a slide, read from its top-level elements. */
export function contentOf(slide: Slide): Content {
  const content: Content = { title: undefined, bodies: [], pictures: [], usedRoles: [], others: [] };
  for (const element of slide.elements) {
    if (element.type === "image") {
      if (words(element)) content.pictures.push(element);
      else if (!element.placeholder) content.others.push(element);
    } else if (element.type === "text") {
      if (!words(element)) continue;
      if (element.placeholder && kindOfRole(element.placeholder) === "title" && element.placeholder.replace(/\d+$/, "") === "title" && !content.title) content.title = element;
      else content.bodies.push(element);
    } else {
      content.others.push(element);
    }
    if (element.placeholder && words(element)) content.usedRoles.push(element.placeholder);
  }
  return content;
}

/** Whether there is anything to arrange. */
export const hasContent = (content: Content): boolean => content.title !== undefined || content.bodies.length > 0 || content.pictures.length > 0;
