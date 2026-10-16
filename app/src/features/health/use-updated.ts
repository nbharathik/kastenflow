// Whether a linked item shown in a page (a board, a deck, a diagram) changed
// after the page showed it. Two things must agree: the vault's counter for the
// item's kind moved (decks and diagrams share one), and the item's own time is
// not the one it had when it was first seen. The first reading is not a change.

import { useEffect, useState } from "react";

import type { RevisionArea } from "../../lib/vault/revision-types";
import { useStamp } from "../workspace/revision";

export interface Updated {
  updated: boolean;
  /** Puts the badge away until the item changes again. */
  dismiss(): void;
}

export function useUpdated(area: Extract<RevisionArea, "boards" | "decks">, modified: number | undefined): Updated {
  const stamp = useStamp(area);
  // What the item looked like when the page first knew it.
  const [seen, setSeen] = useState<{ stamp: string; modified: number } | null>(null);
  // The time that was put away with a click.
  const [away, setAway] = useState<number | null>(null);
  useEffect(() => {
    if (seen === null && modified !== undefined) setSeen({ stamp, modified });
  }, [seen, stamp, modified]);
  const changed = seen !== null && stamp !== seen.stamp && modified !== undefined && modified !== seen.modified;
  return { updated: changed && away !== modified, dismiss: () => setAway(modified ?? null) };
}
