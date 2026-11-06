// Reaching what lies under something else: a click again at the same point steps down the pile of elements under it, and
// "Select behind" in the right-click menu does the same from the point the menu was opened at.

import type { EditorSession } from "../session/session.ts";
import { itemsOf, stackAt } from "./geometry.ts";

/** The element under `current` in a pile listed topmost first, wrapping to the top after the last; null when there is nothing else to step to. */
export function below(stack: readonly string[], current: string): string | null {
  const at = stack.indexOf(current);
  if (at < 0 || stack.length < 2) return null;
  return stack[(at + 1) % stack.length] ?? null;
}

/** Where a right click last opened a menu on the slide, and the zoom it was made at (a click's reach is a few screen pixels). */
const opened = new WeakMap<EditorSession, { x: number; y: number; zoom: number }>();

export function rememberMenuPoint(session: EditorSession, at: { x: number; y: number }, zoom: number): void {
  opened.set(session, { x: at.x, y: at.y, zoom });
}

/** The element "Select behind" would select: the one under the selected element at the point of the last right click. */
function behindMenuPoint(session: EditorSession): string | null {
  const point = opened.get(session);
  const [current] = session.state.selection;
  if (!point || current === undefined || session.state.selection.length !== 1) return null;
  return below(stackAt(itemsOf(session), point, point.zoom), current);
}

export const canSelectBehind = (session: EditorSession): boolean => behindMenuPoint(session) !== null;

/** Selects the element under the selected one at the point of the last right click. */
export function selectBehind(session: EditorSession): void {
  const next = behindMenuPoint(session);
  if (next !== null) session.select([next]);
}
