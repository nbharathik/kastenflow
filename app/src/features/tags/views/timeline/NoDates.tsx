// The aside of a timeline: the notes with no start date, each with a "Set
// dates" action that gives it today (and an end, if the view has one) as one
// change with an Undo; drag the bar from there to where it belongs.

import { memo, type MouseEvent } from "react";

import type { Item } from "./items";

interface NoDatesProps {
  items: readonly Item[];
  /** Whether dates can be written here: not when the start is calculated. */
  canSet: boolean;
  /** The property the timeline starts at, named in the explanation. */
  startKey: string;
  onSet(item: Item): void;
  onOpen(event: MouseEvent<HTMLElement>, id: string): void;
}

export const NoDates = memo(function NoDates({ items, canSet, startKey, onSet, onOpen }: NoDatesProps) {
  return (
    <aside className="kasten-tl-nodates" aria-label="No dates">
      <h2>
        No dates <span className="text-muted">{items.length.toLocaleString()}</span>
      </h2>
      <p>{canSet ? `These have no “${startKey}” date, so they are not on the timeline.` : `These have no “${startKey}” date, which is worked out from other properties, so they are not on the timeline.`}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="kasten-tl-nodates-name" title={item.title} onClick={(event) => onOpen(event, item.id)}>
              {item.title}
            </button>
            {canSet && (
              <button type="button" className="kasten-tl-nodates-set" aria-label={`Set dates for ${item.title}`} onClick={() => onSet(item)}>
                Set dates
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
});
