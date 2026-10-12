// Where the page in a frame is in its presentation, for the page around the editor.

import { useSyncExternalStore, type RefObject } from "react";

import { onPresenting, presentingIn, type PresentInfo } from "../editor/sections/presenting";

/** The slide the editor in `frame` is showing, or null when it is not being presented. The same page open in
 * another pane is presented there, not here. */
export function usePresenting(frame: RefObject<HTMLElement | null>): PresentInfo | null {
  return useSyncExternalStore(onPresenting, () => presentingIn(frame.current));
}
