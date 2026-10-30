// The chip a selection becomes: "Selection · “first words…” · Page title".

import type { Chip } from "../thread";
import type { SelectionSnapshot } from "./sources";

/** How many characters of the selected words the chip shows. */
const WORDS = 28;

/** The first words of a selection on one line, cut with an ellipsis. */
export function firstWords(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > WORDS ? `${flat.slice(0, WORDS - 1).trimEnd()}…` : flat;
}

/** The chip for a selection. Automatic ones are replaced by the next selection; kept ones ("Add to chat") stay. */
export function selectionChip(snapshot: SelectionSnapshot, kept: boolean): Chip {
  const { source, text, heading, range, title } = snapshot;
  return {
    kind: "selection",
    label: `Selection · “${firstWords(text)}” · ${title}`,
    ref: [],
    origin: kept ? "added" : "auto",
    selection: { source, text: text.trim(), ...(heading ? { heading } : {}), ...(range ? { range } : {}), pinned: kept },
  };
}

/** The most snippets one chat keeps with "Add to chat". */
export const MAX_KEPT = 5;
