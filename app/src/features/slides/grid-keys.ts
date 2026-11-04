// Arrow keys between the cards of the Slides home. One card is a tab stop at a time (the one last used); the arrows move the focus
// from card to card, by row and by column in a grid and by row in a list.

export type Move = "left" | "right" | "up" | "down" | "first" | "last";

const MOVES: Record<string, Move> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "first", End: "last" };

/** The move a key stands for, if it is one. */
export const moveOf = (key: string): Move | null => MOVES[key] ?? null;

/** The card a move leads to from `from`, among `count` cards laid in rows of `columns`; stays where it is at an edge. */
export function nextIndex(move: Move, from: number, count: number, columns: number): number {
  if (count <= 0) return -1;
  const step = Math.max(1, columns);
  const to = move === "left" ? from - 1 : move === "right" ? from + 1 : move === "up" ? from - step : move === "down" ? from + step : move === "first" ? 0 : count - 1;
  return to < 0 || to >= count ? Math.min(Math.max(from, 0), count - 1) : to;
}

/** How many cards sit in one row: those that share the first one's top edge. A list is one. */
export function columnsOf(cards: readonly Element[]): number {
  const first = cards[0];
  if (!first) return 1;
  const top = first.getBoundingClientRect().top;
  let columns = 0;
  for (const card of cards) {
    if (card.getBoundingClientRect().top !== top) break;
    columns += 1;
  }
  return Math.max(1, columns);
}
