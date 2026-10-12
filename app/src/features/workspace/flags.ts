// Small yes-or-no memories of this window, kept in its storage like the
// other preferences: which dashboard lists show everything instead of their
// newest few, which groups are folded. A name is on or absent; the oldest
// names go first, so the list never grows without end.

import { create } from "zustand";

const KEY = "kasten.flags";
/** Names kept at most. */
const MOST = 300;

function load(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

interface Flags {
  on: string[];
  /** Turns a name on or off; without `to`, the other way round. */
  toggle(name: string, to?: boolean): void;
}

export const useFlags = create<Flags>((set, get) => ({
  on: load(),
  toggle(name, to) {
    const { on } = get();
    const next = to ?? !on.includes(name);
    if (next === on.includes(name)) return;
    const list = next ? [...on, name].slice(-MOST) : on.filter((n) => n !== name);
    set({ on: list });
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // The memory lasts until the window closes.
    }
  },
}));

/** Whether `name` is on, and how to turn it on or off (or the other way round). */
export function useFlag(name: string): [boolean, (to?: boolean) => void] {
  const on = useFlags((s) => s.on.includes(name));
  return [on, (to) => useFlags.getState().toggle(name, to)];
}
