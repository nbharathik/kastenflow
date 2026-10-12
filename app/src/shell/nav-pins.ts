// The views pinned to the sidebar, as the window keeps them (a preference).

import { useMemo } from "react";

import { usePrefs } from "../features/workspace/prefs";
import { moveNav, pin, pinnedIds, unpin, type NavId } from "./nav";

export interface NavPins {
  /** The pinned views, in order. */
  pinned: NavId[];
  pin(id: string): void;
  unpin(id: string): void;
  move(id: string, step: -1 | 1): void;
}

/** The pinned views and the ways to change them; every change is kept at once. */
export function useNavPins(): NavPins {
  const saved = usePrefs((s) => s.navPinned);
  const pinned = useMemo(() => pinnedIds(saved), [saved]);
  return useMemo(() => {
    const keep = (list: string[]) => usePrefs.getState().set({ navPinned: list });
    return {
      pinned,
      pin: (id) => keep(pin(pinned, id)),
      unpin: (id) => keep(unpin(pinned, id)),
      move: (id, step) => keep(moveNav(pinned, id, step)),
    };
  }, [pinned]);
}
