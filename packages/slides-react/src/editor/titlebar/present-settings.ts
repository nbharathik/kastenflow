// What the Slideshow options change about how the deck is shown: going round again, moving on by itself, and the custom shows. Each is the
// deck's own setting (`set_present`), one step of undo, and is kept with the deck.

import type { CustomShow, Deck } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

/** The waits the menu offers for a show that moves on by itself, in seconds; 0 is off. */
export const INTERVALS: readonly number[] = [0, 3, 5, 10, 15, 30, 60];

/** The most custom shows a deck keeps, and the longest a name may be (the deck refuses more). */
export const MOST_SHOWS = 32;
export const LONGEST_NAME = 80;

export const isLooping = (deck: Deck): boolean => deck.present.loop === true;
export const intervalOf = (deck: Deck): number => deck.present.autoAdvance ?? 0;
export const showsOf = (deck: Deck): CustomShow[] => deck.present.shows ?? [];

/** An interval in words: "Off", "5 seconds", "1 minute". */
export function intervalName(seconds: number): string {
  if (seconds <= 0) return "Off";
  if (seconds % 60 === 0) return seconds === 60 ? "1 minute" : `${seconds / 60} minutes`;
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/** Whether the show goes back to the first slide after the last. */
export function setLoop(session: EditorSession, on: boolean): void {
  if (isLooping(session.deck) === on) return;
  session.run(() => session.core.apply("set_present", { loop: on }));
}

/** Seconds after which the show moves on by itself; 0 for the presenter's own clicks. */
export function setAutoAdvance(session: EditorSession, seconds: number): void {
  if (intervalOf(session.deck) === seconds) return;
  session.run(() => session.core.apply("set_present", { autoAdvance: seconds }));
}

/** Replaces the deck's custom shows. */
export function setShows(session: EditorSession, shows: CustomShow[]): void {
  session.run(() => session.core.apply("set_present", { shows }));
}

/** An id no show of the list has: `show-1`, `show-2` ... */
export function nextShowId(shows: readonly CustomShow[]): string {
  const taken = new Set(shows.map((show) => show.id));
  for (let n = 1; ; n++) if (!taken.has(`show-${n}`)) return `show-${n}`;
}

/** A name no show of the list has: "Custom show 1", "Custom show 2" ... */
export function nextShowName(shows: readonly CustomShow[]): string {
  const taken = new Set(shows.map((show) => show.name));
  for (let n = shows.length + 1; ; n++) if (!taken.has(`Custom show ${n}`)) return `Custom show ${n}`;
}

/** Why a show cannot be kept as it is, or null when it can. The deck refuses the same things, so the dialog can say so before it asks. */
export function problemWith(show: CustomShow, shows: readonly CustomShow[]): string | null {
  const name = show.name.trim();
  if (name === "") return "Give the show a name.";
  if (name.length > LONGEST_NAME) return `A name is at most ${LONGEST_NAME} characters.`;
  if (shows.some((other) => other.id !== show.id && other.name.trim().toLowerCase() === name.toLowerCase())) return "Another show has that name.";
  if (show.slides.length === 0) return "Pick at least one slide.";
  return null;
}
