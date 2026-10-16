// The cards around the one in front of you: the two before it and the next
// few, as a short list to jump along, so a batch has its place in view.

import { relativeTime } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { caughtAt } from "../workspace/capture";
import { titleOf } from "../workspace/names";

const BEFORE = 2;
const AFTER = 4;

export function TriageContext({ cards, index, onPick }: { cards: readonly NoteMeta[]; index: number; onPick(index: number): void }) {
  if (cards.length < 2) return null;
  const from = Math.max(0, index - BEFORE);
  const to = Math.min(cards.length, index + AFTER + 1);
  return (
    <nav aria-label="Around this card" className="mt-6">
      <p className="text-12 font-medium text-muted">In the queue</p>
      <ol className="mt-1 flex flex-col">
        {cards.slice(from, to).map((card, i) => {
          const at = from + i;
          return (
            <li key={card.path}>
              <button
                type="button"
                aria-current={at === index ? "true" : undefined}
                onClick={() => onPick(at)}
                className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-13 ${at === index ? "bg-soft font-medium" : "text-muted hover:bg-hover"}`}
              >
                <span className="min-w-0 flex-1 truncate">{titleOf(card)}</span>
                <span className="shrink-0 text-12 text-faint">{relativeTime(caughtAt(card))}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {to < cards.length && <p className="px-2 pt-1 text-12 text-muted">and {cards.length - to} more</p>}
    </nav>
  );
}
