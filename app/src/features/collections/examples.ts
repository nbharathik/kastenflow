// Collections worth starting from, offered where there are none yet. Each is
// an ordinary collection once saved: nothing about it is special.

import type { Collection, CollectionEdits } from "../../lib/vault/collection-types";

export interface CollectionExample {
  id: string;
  name: string;
  /** One line that says what it finds. */
  about: string;
  edits: CollectionEdits;
}

export const EXAMPLES: readonly CollectionExample[] = [
  {
    id: "unprocessed-captures",
    name: "Unprocessed captures",
    about: "Pages and selections saved from the web that nobody has triaged yet.",
    edits: {
      icon: "bookmark",
      query: "#capture",
      filter: [{ key: "status", op: "is", value: "New" }],
      sort: [{ key: "captured", dir: "desc" }],
      display: { type: "table", columns: ["title", "site", "captured", "reading"], limit: 500 },
    },
  },
  {
    id: "captured-this-week",
    name: "Captured this week",
    about: "Everything saved in the last seven days (by your own clock), newest first.",
    edits: {
      icon: "calendar",
      query: "#capture",
      when: { created: "last-7-days" },
      sort: [{ key: "created", dir: "desc" }],
      display: { type: "list", limit: 200 },
    },
  },
  {
    id: "recently-changed-research",
    name: "Recently changed research",
    about: "Research pages and papers changed in the last 30 days.",
    edits: {
      icon: "book",
      query: "#paper",
      when: { updated: "last-30-days" },
      sort: [{ key: "updated", dir: "desc" }],
      display: { type: "list", limit: 200 },
    },
  },
  {
    id: "experiments-needing-review",
    name: "Experiments needing review",
    about: "Experiments that are analysed and wait for a review.",
    edits: {
      icon: "bulb",
      query: "#experiment",
      filter: [{ key: "status", op: "is", value: "Analysed" }],
      sort: [{ key: "updated", dir: "desc" }],
      display: { type: "table", limit: 500 },
    },
  },
];

/** The examples whose names no collection has yet (any case). */
export function missingExamples(have: readonly Pick<Collection, "name">[]): CollectionExample[] {
  const taken = new Set(have.map((c) => c.name.trim().toLowerCase()));
  return EXAMPLES.filter((example) => !taken.has(example.name.toLowerCase()));
}
