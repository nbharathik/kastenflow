// What the editor asks of the engine for the deck's own font files and word list: each is one operation, so one step of undo.

import type { DeckFont } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

/** Replaces the font files the deck carries. False when the engine refused (the person is told why). */
export function setDeckFonts(session: EditorSession, fonts: readonly DeckFont[]): boolean {
  return session.run(() => session.core.apply("set_deck_fonts", { fonts: [...fonts] })) !== undefined;
}

/** Adds words to, or takes words from, the list the spelling check leaves alone. False when the engine refused. */
export function setDictionary(session: EditorSession, change: { add?: readonly string[]; remove?: readonly string[] }): boolean {
  const input = { ...(change.add ? { add: [...change.add] } : {}), ...(change.remove ? { remove: [...change.remove] } : {}) };
  return session.run(() => session.core.apply("set_dictionary", input)) !== undefined;
}
