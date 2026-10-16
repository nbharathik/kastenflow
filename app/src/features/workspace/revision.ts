// The vault's change counters in the window: the core bumps them after every
// change to the vault's files, whoever made it, and tells the window
// (`vault-revision`). A view that depends on a kind of file watches the
// counter for that kind (`useStamp("notes", "boards")`) and loads again when
// it moves, instead of guessing from the notes it holds.

import { create } from "zustand";

import type { Revision, RevisionArea } from "../../lib/vault/revision-types";
import type { VaultClient } from "../../lib/vault/types";

export const NO_REVISION: Revision = { epoch: 0, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };

interface RevisionState {
  revision: Revision;
}

export const useRevision = create<RevisionState>()(() => ({ revision: NO_REVISION }));

/** Takes the core's newest counters. Events and the first reading can cross, so
 * one that is older than what the window holds (same opening, lower count) is
 * ignored; a different opening of the vault always replaces. */
export function applyRevision(next: Revision): void {
  const { revision } = useRevision.getState();
  if (next.epoch === revision.epoch && next.all < revision.all) return;
  useRevision.setState({ revision: next });
}

/** Forgets the counters (the vault was closed). */
export function resetRevision(): void {
  useRevision.setState({ revision: NO_REVISION });
}

/** Reads the counters now; the core's events (`VaultEvents.revised`) keep them current after that. */
export function loadRevision(client: VaultClient): void {
  client.revision().then(applyRevision, () => {
    // The first event brings them.
  });
}

/** One string for the counters of `areas`: it changes when any of them moves, and never otherwise. */
export function stampOf(revision: Revision, areas: readonly RevisionArea[]): string {
  return [revision.epoch, ...areas.map((area) => revision[area])].join(":");
}

/** Changes whenever a file of one of these kinds is added, removed or changed. */
export function useStamp(...areas: RevisionArea[]): string {
  return useRevision((s) => stampOf(s.revision, areas));
}
