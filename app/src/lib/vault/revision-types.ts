// Revision: the vault's change counters, which views compare to know they
// are out of date (the shapes of kasten-core's revision, serde camelCase)
// and the call the app makes. The window follows it through the core's
// `vault-revision` event (`VaultEvents.revised`).

import type { DraftRule } from "./draft-rule";

/**
 * Counters the core bumps after each change to the vault's files, whoever
 * made it. `all` counts every change; each area counts the changes to its
 * own files (`*.md` notes, `*.canvas` boards, `*.deck` / `*.drawio` /
 * `*.drawio.svg` decks and diagrams, `tags/*.yaml`, `*.bib`,
 * `views/*.yaml`, `*.comments.json` / `*.highlights.json`). `epoch` is when the
 * vault was opened, so counters of two openings never look alike.
 */
export interface Revision {
  epoch: number;
  all: number;
  notes: number;
  boards: number;
  decks: number;
  tags: number;
  references: number;
  collections: number;
  annotations: number;
}

/** The counters a view can watch. */
export type RevisionArea = Exclude<keyof Revision, "epoch" | "all">;

export const REVISION_AREAS: readonly RevisionArea[] = ["notes", "boards", "decks", "tags", "references", "collections", "annotations"];

export interface RevisionOps {
  /** The counters as they are now. */
  revision(): Promise<Revision>;
}

/** What a call about a draft does, for each call of `RevisionOps`. */
export const REVISION_RULES = {
  revision: "pass",
} as const satisfies Record<keyof RevisionOps, DraftRule>;
