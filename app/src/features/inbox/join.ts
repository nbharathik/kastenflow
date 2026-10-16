// Which saved collections a card can be added to. A collection is a search
// kept under a name; its notes are never stored, so a card joins one by
// matching it. That can be done for a collection that asks for nothing but
// tags (`#reading #papers`): the card gains those tags. A collection with
// words, a project, days or filters in it cannot be joined by one action, and
// is listed with the reason.

import type { Collection } from "../../lib/vault/collection-types";

/** The tags that make a note match the collection, when tags are all it asks for. */
export function joinTags(collection: Pick<Collection, "query" | "when" | "filter" | "problem" | "readOnly">): string[] | null {
  if (collection.problem || collection.readOnly || collection.when || collection.filter.length > 0) return null;
  const words = collection.query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const tags = words.map((word) => /^#[\p{L}\p{N}_\-/]{1,40}$/u.exec(word)?.[0].slice(1));
  return tags.every((tag) => tag !== undefined) ? (tags as string[]) : null;
}

/** Why a card cannot be added to the collection, or null when it can. */
export function whyNotJoin(collection: Pick<Collection, "query" | "when" | "filter" | "problem" | "readOnly">): string | null {
  if (collection.problem || collection.readOnly) return "Cannot be changed here";
  return joinTags(collection) === null ? "A search: cards match it" : null;
}
