// The Whiteboards and Decks cards of Home and of a project's home: the
// four most recently edited as compact rows, however many there are, and
// "Show all N" to see the rest in place (remembered per list, so each
// project keeps its own). The card's count stays the real total.

import { Fragment, useMemo, type ReactNode } from "react";

import { Icon } from "../../ui/Icon";
import { useFlag } from "../workspace/flags";
import { MoreToggle } from "./DashCard";

/** How many a card shows before "Show all". */
export const CARD_LIMIT = 4;

/** Most recently edited first. */
export function newest<T extends { path: string; modified: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
}

/** `memory` names the list (`boards:demo`, `decks:home`) for the window to remember. */
export function MiniList<T extends { path: string; modified: number }>({ items, memory, row }: { items: readonly T[]; memory: string; row(item: T): ReactNode }) {
  const [all, toggle] = useFlag(`all:${memory}`);
  const sorted = useMemo(() => newest(items), [items]);
  const shown = all ? sorted : sorted.slice(0, CARD_LIMIT);
  return (
    <>
      <div className="kasten-minis">
        {shown.map((item) => (
          <Fragment key={item.path}>{row(item)}</Fragment>
        ))}
      </div>
      <MoreToggle total={sorted.length} shown={CARD_LIMIT} open={all} onToggle={() => toggle()} />
    </>
  );
}

/** A quiet link in a card's head that goes to the whole view. */
export function SeeAll({ label, run }: { label: string; run: () => void }) {
  return (
    <button type="button" className="kasten-dash-action" onClick={run}>
      {label}
      <Icon name="arrow-up-right" className="size-3.5" />
    </button>
  );
}
