// Where the person was in each collection: the note selected and how far the
// list was scrolled, kept for the window's life so that leaving a collection
// and coming back, or opening a note and returning, finds the same place.

export interface Position {
  /** The note shown in the preview. */
  active: string | null;
  scroll: number;
}

const kept = new Map<string, Position>();

export const recallPosition = (path: string): Position => kept.get(path) ?? { active: null, scroll: 0 };

export function rememberPosition(path: string, position: Position): void {
  kept.set(path, position);
}

/** After a rename or a trash: the place goes with the collection. */
export function movePosition(from: string, to: string | null): void {
  const position = kept.get(from);
  kept.delete(from);
  if (position && to) kept.set(to, position);
}

/** Starts again (for tests). */
export function forgetPositions(): void {
  kept.clear();
}
