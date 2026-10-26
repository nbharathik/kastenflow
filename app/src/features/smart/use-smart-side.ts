// Which side of a smart page a person is looking at: the smart view, its
// notes (the Markdown page), or the history of its code. Kept per page while
// the app runs, so coming back to a page finds it as it was left; a page not
// seen yet opens on its smart view.

import { create } from "zustand";

export type SmartSide = "smart" | "notes" | "history" | "code";

const useSides = create<{ of: Readonly<Record<string, SmartSide>> }>()(() => ({ of: {} }));

/** The side shown for the page known by `key` (its id, or its path while it has none), and a way to change it. */
export function useSmartSide(key: string): [SmartSide, (side: SmartSide) => void] {
  const side = useSides((s) => s.of[key] ?? "smart");
  return [side, (next) => setSmartSide(key, next)];
}

export function smartSideOf(key: string): SmartSide {
  return useSides.getState().of[key] ?? "smart";
}

export function setSmartSide(key: string, side: SmartSide): void {
  useSides.setState((s) => ({ of: { ...s.of, [key]: side } }));
}

/** Forgets every choice (tests). */
export function forgetSmartSides(): void {
  useSides.setState({ of: {} });
}
