// The browser preview's stand-in for the core's revision counters: after each
// write the preview compares a cheap fingerprint of every kind of file with
// the one before, and bumps the counters of the kinds that differ (the core
// bumps them for exactly the paths a change touched).

import type { Revision, RevisionArea } from "../../../lib/vault/revision-types";

/** A fingerprint per kind of file; a kind a preview class does not know is left out. */
export type Signs = Partial<Record<RevisionArea, string>>;

/** How many texts there are, how long they are in all and, for files that carry one, their times. */
export function sign(texts: Record<string, string | { text: string; modified?: number }> | undefined): string {
  let count = 0;
  let size = 0;
  let times = 0;
  for (const value of Object.values(texts ?? {})) {
    count++;
    if (typeof value === "string") size += value.length;
    else {
      size += value.text.length;
      times += value.modified ?? 0;
    }
  }
  return `${count}:${size}:${times}`;
}

export class Revisions {
  private readonly counters: Revision;
  private signs: Signs;
  private readonly listeners = new Set<(revision: Revision) => void>();

  /** `known` is false when the preview already changed before anyone looked: then every kind counts as changed once. */
  constructor(epoch: number, first: Signs, known = true) {
    const start = known ? 0 : 1;
    this.counters = { epoch, all: start, notes: start, boards: start, decks: start, tags: start, references: start, collections: start, annotations: start };
    this.signs = first;
  }

  get revision(): Revision {
    return { ...this.counters };
  }

  /** Bumps the kinds whose fingerprint moved and tells the listeners; true when any did. */
  update(next: Signs): boolean {
    let changed = false;
    for (const area of Object.keys(next) as RevisionArea[]) {
      if (this.signs[area] === next[area]) continue;
      this.counters[area]++;
      changed = true;
    }
    this.signs = { ...this.signs, ...next };
    if (changed) {
      this.counters.all++;
      for (const listener of [...this.listeners]) listener(this.revision);
    }
    return changed;
  }

  watch(listener: (revision: Revision) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
