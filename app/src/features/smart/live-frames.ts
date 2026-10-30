// How many smart blocks run at once inside one page. A page that holds many
// blocks would otherwise start many sandboxed frames; at most four run, and
// the rest wait behind "Click to run". A click takes the place of a block that
// is scrolled out of sight (it goes back to waiting), and when all four are in
// view the click is refused with a sentence, not silently.

import { MAX_LIVE_FRAMES } from "../../lib/vault/smart-types";

/** One block that may run. `onScreen` is kept up to date by the block. */
export interface Runner {
  onScreen: boolean;
  /** Called when another block took this one's place. */
  evict(): void;
}

const scopes = new Map<string, Set<Runner>>();

/** Gives `runner` a place in `scope` (a page) if there is one. With `force` (a person's click) it may take the place of a block that is off screen. */
export function claim(scope: string, runner: Runner, force = false): boolean {
  const held = scopes.get(scope) ?? new Set<Runner>();
  scopes.set(scope, held);
  if (held.has(runner)) return true;
  if (held.size < MAX_LIVE_FRAMES) {
    held.add(runner);
    return true;
  }
  if (force) {
    const victim = [...held].find((other) => !other.onScreen);
    if (victim) {
      held.delete(victim);
      victim.evict();
      held.add(runner);
      return true;
    }
  }
  return false;
}

/** Gives the place back (the block went away, or was evicted). */
export function release(scope: string, runner: Runner): void {
  const held = scopes.get(scope);
  if (!held) return;
  held.delete(runner);
  if (held.size === 0) scopes.delete(scope);
}

/** How many blocks run in `scope` now. */
export const running = (scope: string): number => scopes.get(scope)?.size ?? 0;

/** The sentence for a click that could not be given a place. */
export const FULL_LINE = `This page already runs ${MAX_LIVE_FRAMES} smart blocks, and all of them are in view. Scroll one away, then click again.`;
