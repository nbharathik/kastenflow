// Where the slide gets its formulas from. KaTeX is large and most windows never draw a formula before the first slide is up, so a slide
// does not import it: `math.ts` (which does) hands itself over here when it loads, and a slide that needs it before then asks for it.
// A page that already imports `math.ts` (the editor, the exports) has it from the start, so drawing there stays synchronous.

import { useEffect, useSyncExternalStore } from "react";

import type { renderMath } from "./math.ts";

/** What a slide needs from `math.ts`. */
export interface MathApi {
  renderMath: typeof renderMath;
}

let api: MathApi | null = null;
let asked = false;
const listeners = new Set<() => void>();

/** Called by `math.ts` as it loads. */
export function provideMath(next: MathApi): void {
  api = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const current = (): MathApi | null => api;

/** The formula maker, or null until its code has loaded (it is asked for on first use). */
export function useMath(): MathApi | null {
  const got = useSyncExternalStore(subscribe, current, current);
  useEffect(() => {
    if (got || asked) return;
    asked = true;
    void import("./math.ts").catch(() => {
      asked = false;
    });
  }, [got]);
  return got;
}
