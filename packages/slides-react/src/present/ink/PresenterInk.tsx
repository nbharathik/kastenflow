// The presenter's pen, highlighter and laser: the tool bar and the keys that pick them. Kept in a module of their own so
// the presenter's window loads them after the slide and the notes are up.

import type { InkStore } from "./store.ts";
import { InkTools, useInkKeys } from "./InkTools.tsx";

/** The keys of the ink, in a view that has ink. */
export function InkKeys({ store }: { store: InkStore }): null {
  useInkKeys(store, true);
  return null;
}

export { InkTools };
