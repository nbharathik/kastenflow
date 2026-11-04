// The presenter's layout as state: read once from where it is kept, kept again at each change, with whether the window is narrow
// enough for the columns to stack.

import { useCallback, useEffect, useState } from "react";

import { type Layout, type Panel, type PresetName, applyPreset, defaultLayout, keepLayout, resetSide, resetSplit, savedLayout, toggled, withSide, withSplit } from "./layout.ts";

/** Below this width the slide, the next slide and the notes are stacked. */
export const NARROW_QUERY = "(max-width: 759px)";

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(NARROW_QUERY);
    const change = () => setNarrow(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return narrow;
}

export interface LayoutControls {
  layout: Layout;
  narrow: boolean;
  setSplit(split: number): void;
  setSide(side: number): void;
  resetSplitter(which: "split" | "side"): void;
  toggle(what: Panel | "clock"): void;
  toggleThen(): void;
  toggleSwap(): void;
  preset(name: PresetName): void;
  reset(): void;
}

export function useLayout(): LayoutControls {
  const [layout, setLayout] = useState(savedLayout);
  const narrow = useNarrow();
  useEffect(() => keepLayout(layout), [layout]);
  const set = useCallback((change: (now: Layout) => Layout) => setLayout(change), []);
  return {
    layout,
    narrow,
    setSplit: useCallback((split) => set((now) => withSplit(now, split)), [set]),
    setSide: useCallback((side) => set((now) => withSide(now, side)), [set]),
    resetSplitter: useCallback((which) => set((now) => (which === "split" ? resetSplit(now) : resetSide(now))), [set]),
    toggle: useCallback((what) => set((now) => toggled(now, what)), [set]),
    toggleThen: useCallback(() => set((now) => ({ ...now, then: !now.then })), [set]),
    toggleSwap: useCallback(() => set((now) => ({ ...now, swap: !now.swap })), [set]),
    preset: useCallback((name) => set((now) => applyPreset(now, name)), [set]),
    reset: useCallback(() => setLayout(defaultLayout()), []),
  };
}
