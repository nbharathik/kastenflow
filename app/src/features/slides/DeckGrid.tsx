import { type KeyboardEvent, useRef, useState } from "react";

import type { DeckInfo } from "../../lib/vault/types";
import { DeckCard } from "./DeckCard";
import { columnsOf, moveOf, nextIndex } from "./grid-keys";
import type { DeckView } from "./home-prefs";

/**
 * The decks as a grid of cards or a list of rows. One card is in the Tab order (the one last focused); the arrow keys, Home and End
 * move between cards by row and column, and Enter opens the focused one.
 */
export function DeckGrid({ decks, view, label }: { decks: readonly DeckInfo[]; view: DeckView; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const current = decks.some((deck) => deck.path === active) ? active : (decks[0]?.path ?? null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches("[data-deck-card]") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") {
      // The button's own click, so Enter opens the way a click does.
      event.preventDefault();
      target.click();
      return;
    }
    const move = moveOf(event.key);
    if (!move) return;
    const cards = [...(box.current?.querySelectorAll<HTMLElement>("[data-deck-card]") ?? [])];
    const from = cards.indexOf(target);
    const to = nextIndex(move, from, cards.length, view === "list" ? 1 : columnsOf(cards));
    event.preventDefault();
    cards[to]?.focus();
  };

  return (
    <div ref={box} role="group" aria-label={label} className={view === "list" ? "sh-list" : "sh-grid"} data-view={view} onKeyDown={onKeyDown}>
      {decks.map((deck) => (
        <DeckCard key={deck.path} info={deck} view={view} tabbable={deck.path === current} onFocusCard={setActive} />
      ))}
    </div>
  );
}
