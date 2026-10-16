// A page's comments sorted into the stacks they are shown in: one for each
// section, one for the page as a whole and one for the comments whose place
// was lost. Within a stack the comments that are open come before the
// resolved ones, each in the order of the words they are about, then in the
// order they were made.

import type { PageComment } from "../../../lib/vault/annotation-types";
import type { Place } from "../../annotations/anchor";

export interface PlacedComment {
  comment: PageComment;
  place: Place;
}

export interface Stacks {
  /** Comments on the page as a whole. */
  page: PlacedComment[];
  /** Comments in each section, by the section's place in the page. */
  sections: PlacedComment[][];
  /** Comments whose section and words are no longer on the page. */
  detached: PlacedComment[];
}

/** Where in the page a comment's words are, or nothing when it has none found. */
const at = (item: PlacedComment): number => ("range" in item.place && item.place.range ? item.place.range.from : Number.POSITIVE_INFINITY);

/** Open comments first; then by the words' place; then as they were made (the sort is stable). */
function inOrder(list: PlacedComment[]): PlacedComment[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Number(Boolean(a.item.comment.resolved)) - Number(Boolean(b.item.comment.resolved)) || at(a.item) - at(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

export function stacksOf(placed: readonly PlacedComment[], sections: number): Stacks {
  const out: Stacks = { page: [], sections: Array.from({ length: Math.max(sections, 1) }, () => []), detached: [] };
  for (const item of placed) {
    const { place } = item;
    if (place.kind === "detached") out.detached.push(item);
    else if (place.kind === "page") out.page.push(item);
    else (out.sections[place.section] ?? out.page).push(item);
  }
  out.page = inOrder(out.page);
  out.sections = out.sections.map(inOrder);
  out.detached = inOrder(out.detached);
  return out;
}

/** How many comments are open (not resolved) among `list`. */
export const openIn = (list: readonly PlacedComment[]): number => list.filter((item) => !item.comment.resolved).length;

/** Who wrote a comment, for people: the agent's name for an agent's. */
export function authorName(author: string): { name: string; agent: boolean } {
  if (author.startsWith("agent:")) return { name: author.slice("agent:".length) || "agent", agent: true };
  return { name: !author || author === "you" ? "You" : author, agent: false };
}
