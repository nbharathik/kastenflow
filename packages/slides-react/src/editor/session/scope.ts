// Which elements the editor is working among: the slide's own, or, inside a group the person has gone into
// (a double click), what that group holds. What is selected, hit and moved is always of the scope, so a
// click on a group selects the group and a double click goes in to select what is in it.

import type { Deck, Element, Slide } from "@kasten-slides/wasm";

/** The element with `id`, looking inside groups. */
export function findElement(list: readonly Element[], id: string): Element | undefined {
  for (const element of list) {
    if (element.id === id) return element;
    if (element.type === "group") {
      const inside = findElement(element.children, id);
      if (inside) return inside;
    }
  }
  return undefined;
}

/** The elements that are selected, wherever on the slide they are (at its own level or inside a group gone into). */
export function selectedElements(state: { deck: Deck; slideId: string; selection: readonly string[] }): Element[] {
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  if (!slide) return [];
  return state.selection.flatMap((id) => {
    const found = findElement(slide.elements, id);
    return found ? [found] : [];
  });
}

/** The group with `id` among `list`, if it is one and is there. */
function groupIn(list: readonly Element[], id: string): Extract<Element, { type: "group" }> | undefined {
  const found = list.find((element) => element.id === id);
  return found?.type === "group" ? found : undefined;
}

/** How far into groups `path` goes on this slide: the ids of the groups, outermost first, that are there one inside the other. */
export function validPath(slide: Slide | undefined, path: readonly string[]): string[] {
  const kept: string[] = [];
  let list: readonly Element[] = slide?.elements ?? [];
  for (const id of path) {
    const group = groupIn(list, id);
    if (!group) break;
    kept.push(id);
    list = group.children;
  }
  return kept;
}

/** The elements the editor works among: the slide's own, or the children of the innermost group of `path`. */
export function scopeOf(slide: Slide | undefined, path: readonly string[]): readonly Element[] {
  let list: readonly Element[] = slide?.elements ?? [];
  for (const id of validPath(slide, path)) list = groupIn(list, id)?.children ?? list;
  return list;
}
