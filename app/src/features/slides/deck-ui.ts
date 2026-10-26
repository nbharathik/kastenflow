// How each deck's editor window was last left (the panel, the slide and picks, the filmstrip), kept for as long as the app runs.
// A deck tab that was put away (another tab came forward and the keep-alive limit sent this one's view away) opens again on it
// instead of on the first slide with nothing open. Plain data from the editor; nothing about the deck's content is stored here.

import type { UiSnapshot } from "@kasten-slides/react";

/** The decks remembered; the oldest is forgotten past this, since a long session opens many. */
const MAX_DECKS = 40;

const kept = new Map<string, UiSnapshot>();

/** How the editor of `deck` was left, if it was. */
export const deckUi = (deck: string): UiSnapshot | undefined => kept.get(deck);

/** Notes how the editor of `deck` stands now. */
export function keepDeckUi(deck: string, snapshot: UiSnapshot): void {
  kept.delete(deck);
  kept.set(deck, snapshot);
  while (kept.size > MAX_DECKS) kept.delete(kept.keys().next().value as string);
}

/** Lets go of what was kept (a deck that was deleted). */
export const forgetDeckUi = (deck: string): void => void kept.delete(deck);

/** The editors that are open now (shown, or kept ready out of sight), by deck: just what is needed to open a panel in one. */
const live = new Map<string, { openPanel(panel: "ai"): void }>();

export function setLiveDeck(deck: string, ui: { openPanel(panel: "ai"): void } | null): void {
  if (ui) live.set(deck, ui);
  else live.delete(deck);
}

/** Opens the deck's assistant panel: now when its editor is open, else the next time it is shown. How a click on a working chat brings the person to it. */
export function wantAssistant(deck: string): void {
  const open = live.get(deck);
  if (open) return open.openPanel("ai");
  const now = kept.get(deck);
  keepDeckUi(deck, now ? { ...now, panel: "ai" } : { panel: "ai", view: "edit", slideId: "", slideSelection: [], selection: [], filmstripOpen: true, filmstripWidth: null, filmstripScroll: 0 });
}

/** For tests: forgets every deck. */
export const resetDeckUi = (): void => kept.clear();
