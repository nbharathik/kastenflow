// A card's place while its code loads: the same frame at about the height of
// the card, so nothing moves when it arrives. The grey lines wait a second
// before they appear, so a card that comes at once never flashes a loader.

import { useEffect, useState } from "react";

import { DashCard } from "../dashboard/DashCard";
import { HOME_SECTIONS, type HomeSection } from "./sections";

/** How long a wait is before it is shown as one. */
export const LOADER_DELAY_MS = 1000;

/** Bones to draw per card, about the lines of the real one. */
const ROWS: Partial<Record<HomeSection, number>> = { schedule: 3, week: 3, journal: 4, agents: 3, boards: 5, decks: 5 };

export function CardPlace({ id, delay = LOADER_DELAY_MS }: { id: HomeSection; delay?: number }) {
  const def = HOME_SECTIONS.find((d) => d.id === id)!;
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return (
    <DashCard title={def.label} icon={def.icon}>
      <div className="kasten-todo-skeleton kasten-card-place" data-late={late ? "true" : "false"} aria-hidden="true">
        {Array.from({ length: ROWS[id] ?? 3 }, (_, i) => (
          <span key={i} className="kasten-todo-bone" />
        ))}
      </div>
    </DashCard>
  );
}
