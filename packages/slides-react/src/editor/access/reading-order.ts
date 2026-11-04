// The order a screen reader goes through a slide in. The usual order is rows from top to bottom, each from left to right (the engine's
// `readingOrder`); a person can change it, and the slide then keeps the list of ids it was given (`access.readingOrder`). Elements that list
// leaves out are read after those it names, in the usual order, and ids of elements that are gone are skipped.

import { type Element, type Slide, type Theme, readingOrder } from "@kasten-slides/wasm";

import { boxOf } from "../../theme/index.ts";

/** The elements in the usual order. */
export function usualOrder(elements: readonly Element[], theme: Theme, layout: string): Element[] {
  const order = readingOrder(elements.map((element) => boxOf(theme, layout, element)));
  return order.flatMap((at) => (elements[at] ? [elements[at]] : []));
}

/** `usual` with the elements `stored` names put first, in its order. */
export function withStored<T extends { id: string }>(usual: readonly T[], stored: readonly string[] | undefined): T[] {
  if (!stored || stored.length === 0) return [...usual];
  const named = stored.flatMap((id) => usual.filter((element) => element.id === id).slice(0, 1));
  const rest = usual.filter((element) => !stored.includes(element.id));
  return [...named, ...rest];
}

/** The slide's elements in the order they are read. */
export function readingOrderOf(slide: Slide, theme: Theme): Element[] {
  return withStored(usualOrder(slide.elements, theme, slide.layout), slide.access?.readingOrder);
}

/** `ids` with the one at `from` moved to `to`. Out of range, or the same place, answers the list as it is. */
export function moved<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
