// Crash recovery: keeping the unsaved edits of the deck in the journal while there are some, finding them again when the deck is opened,
// and bringing them back through the engine's own operations. Nothing here touches the deck's file or the vault.

import type { Deck } from "@kasten-slides/wasm";

import { readDeck } from "../dialogs/import-layouts.ts";
import type { SlidesHost } from "../host.ts";
import type { EditorSession } from "../session/session.ts";
import { type JournalEntry, type RecoveryJournal, hashText, indexedDbJournal } from "./journal.ts";

/** How long the editor waits after a change before the journal is written. */
export const JOURNAL_DELAY = 400;

/** What was found in the journal on opening: the edits, and whether the file has changed since they were made. */
export interface Offer {
  entry: JournalEntry;
  fileChanged: boolean;
}

/** The journal a host uses: its own, else the page's IndexedDB, else none. */
export function journalOf(host: Pick<SlidesHost, "recovery">): RecoveryJournal | null {
  return host.recovery ?? indexedDbJournal();
}

/** What names this deck in the journal: where the host keeps it, else its id. */
export function keyOf(session: EditorSession): string {
  return session.host.deckPath ?? session.deck.id;
}

/**
 * Looks in the journal for edits that were never saved. What it holds is newer than the file by construction: the journal is emptied when a
 * save succeeds, so an entry that is left is a change the file never got. An entry equal to the deck as opened, or one that cannot be read, is not offered.
 */
export async function detect(session: EditorSession, journal: RecoveryJournal): Promise<Offer | null> {
  const key = keyOf(session);
  const entry = await journal.read(key).catch(() => null);
  if (!entry) return null;
  const current = session.core.save();
  if (entry.text === current) {
    await journal.clear(key).catch(() => undefined);
    return null;
  }
  try {
    readDeck(entry.text);
  } catch {
    await journal.keepAside(key).catch(() => undefined);
    return null;
  }
  return { entry, fileChanged: entry.base !== hashText(current) };
}

/** Writes the deck to the journal while it has unsaved edits, and empties the journal when it is saved. Answers how to stop. */
export function follow(session: EditorSession, journal: RecoveryJournal, delay: number = JOURNAL_DELAY): () => void {
  const key = keyOf(session);
  let base = hashText(session.core.save());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let last = "";
  let stopped = false;

  const check = (): void => {
    if (stopped) return;
    clearTimeout(timer);
    if (session.state.saving.status === "saved") {
      if (!dirty) return;
      dirty = false;
      last = "";
      base = hashText(session.core.save());
      void journal.clear(key).catch(() => undefined);
      return;
    }
    dirty = true;
    timer = setTimeout(() => {
      if (stopped) return;
      const text = session.core.save();
      if (text === last) return;
      last = text;
      void journal.write(key, { text, time: Date.now(), base }).catch(() => undefined);
    }, delay);
  };
  const stop = session.subscribe(check);
  return () => {
    stopped = true;
    clearTimeout(timer);
    stop();
  };
}

/** Brings the journal's edits back as the deck, as one step of undo that is saved like any change. Answers whether it worked. */
export function recover(session: EditorSession, offer: Offer): boolean {
  let deck: Deck;
  try {
    deck = readDeck(offer.entry.text);
  } catch {
    return false;
  }
  const done = session.run(() => session.core.apply("replace_deck", { deck }));
  if (!done) return false;
  void session.flush();
  return true;
}

/** Turns the recovery down. The edits are kept aside in the journal's own store (the last ones only), never in the vault, and are not offered again. */
export async function discard(session: EditorSession, journal: RecoveryJournal): Promise<void> {
  await journal.keepAside(keyOf(session)).catch(() => undefined);
}
