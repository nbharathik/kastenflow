import type { Element } from "@kasten-slides/wasm";

import type { SlideMode } from "./context.ts";

/**
 * The elements as a show draws them: a sound that asked to be hidden has no chip on the slide the audience sees. Everywhere else (the
 * editor, a thumbnail, an export) the chip is drawn, so there is something to select. The same list comes back when nothing is hidden.
 */
export function withoutHiddenAudio(elements: readonly Element[], mode: SlideMode): readonly Element[] {
  if (mode !== "present") return elements;
  const hides = (element: Element): boolean => element.type === "audio" && element.hidden === true;
  const holds = (list: readonly Element[]): boolean => list.some((element) => hides(element) || (element.type === "group" && holds(element.children)));
  if (!holds(elements)) return elements;
  const strip = (list: readonly Element[]): Element[] =>
    list.filter((element) => !hides(element)).map((element) => (element.type === "group" ? { ...element, children: strip(element.children) } : element));
  return strip(elements);
}
