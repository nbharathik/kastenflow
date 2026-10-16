// What the review screens remember in this window, for each vault: whether the
// weekly reminder is on (off until asked for) and on which weekday, the day
// each kind of review was last marked done, the day the reminder was put off,
// and whether highlights to revisit show. These are the window's own choices,
// not vault content: opening a review writes nothing to the vault, and nothing
// here says a review was missed.

import { create } from "zustand";

import { useWorkspace } from "../workspace/store";
import type { ReviewKind } from "./assemble";

export interface ReviewPrefs {
  /** The weekly reminder, a banner in the window. Off by default. */
  remind: boolean;
  /** The day of the week it first shows: 0 Sunday to 6 Saturday. */
  weekday: number;
  /** The day each kind of review was marked done, if ever. */
  last: Record<ReviewKind, string | null>;
  /** The day the banner was put off: it comes back the next day. */
  snoozed: string | null;
  /** Highlights to revisit show in a review. */
  highlights: boolean;
}

export const DEFAULT_REVIEW: ReviewPrefs = { remind: false, weekday: 5, last: { daily: null, weekly: null }, snoozed: null, highlights: true };

const KEY = "kasten.reviews";
const day = (value: unknown): string | null => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

/** Takes only the valid parts of what was stored. */
export function readSaved(raw: unknown): ReviewPrefs {
  const saved = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const last = (typeof saved.last === "object" && saved.last !== null ? saved.last : {}) as Record<string, unknown>;
  return {
    remind: saved.remind === true,
    weekday: typeof saved.weekday === "number" && Number.isInteger(saved.weekday) && saved.weekday >= 0 && saved.weekday <= 6 ? saved.weekday : DEFAULT_REVIEW.weekday,
    last: { daily: day(last.daily), weekly: day(last.weekly) },
    snoozed: day(saved.snoozed),
    highlights: saved.highlights !== false,
  };
}

function load(): Record<string, ReviewPrefs> {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof all === "object" && all !== null ? Object.fromEntries(Object.entries(all).map(([vault, raw]) => [vault, readSaved(raw)])) : {};
  } catch {
    return {};
  }
}

interface ReviewPrefsState {
  saved: Record<string, ReviewPrefs>;
  set(vault: string, patch: Partial<ReviewPrefs>): void;
}

export const useReviewPrefs = create<ReviewPrefsState>()((set, get) => ({
  saved: load(),
  set(vault, patch) {
    const prefs = { ...(get().saved[vault] ?? DEFAULT_REVIEW), ...patch };
    const saved = { ...get().saved, [vault]: prefs };
    set({ saved });
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      // The choices last until the window closes.
    }
  },
}));

/** This vault's choices, and a way to change them. */
export function useVaultReview(): [ReviewPrefs, (patch: Partial<ReviewPrefs>) => void] {
  const vault = useWorkspace((s) => s.client?.label ?? "");
  const prefs = useReviewPrefs((s) => s.saved[vault]) ?? DEFAULT_REVIEW;
  return [prefs, (patch) => useReviewPrefs.getState().set(vault, patch)];
}

/** The choices of the vault open now, outside a component. */
export function currentReview(): ReviewPrefs {
  const vault = useWorkspace.getState().client?.label ?? "";
  return useReviewPrefs.getState().saved[vault] ?? DEFAULT_REVIEW;
}

/** Marks a review done on `when` (null takes the mark away); returns the day it was marked before. */
export function markDone(kind: ReviewKind, when: string | null): string | null {
  const vault = useWorkspace.getState().client?.label ?? "";
  const now = currentReview();
  useReviewPrefs.getState().set(vault, { last: { ...now.last, [kind]: when } });
  return now.last[kind];
}
