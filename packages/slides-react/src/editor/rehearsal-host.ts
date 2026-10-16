// What a host gives the editor to keep rehearsals in. Kasten keeps them in the app's data folder, on this computer (a rehearsal is a timing
// of a person's practice, not a part of the deck or the vault); a host without a place of its own leaves `rehearsals` out and they are
// kept in the page's local storage, the last ten for each deck.

import { type RehearsalStore, localRehearsals } from "../present/rehearsal-store.ts";
import type { SlidesHost } from "./host.ts";

export type { RehearsalStore } from "../present/rehearsal-store.ts";

let local: RehearsalStore | undefined;

/** The place rehearsals are kept for this host: its own, else the page's local storage. */
export function rehearsalsOf(host: Pick<SlidesHost, "rehearsals">): RehearsalStore {
  return host.rehearsals ?? (local ??= localRehearsals());
}
