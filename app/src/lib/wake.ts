// Noticing that the computer slept, or that its clock was set. A beat counts
// the time between its own runs: a gap far longer than the beat (the laptop was
// asleep, so no timer ran) or one that runs backward (the clock was set back) is
// told to the window as a `kasten:wake` event, and to anyone listening.
//
// This is the one beat that does not rest while the window is hidden: it is
// what finds out that time passed. It does no work of its own and costs a
// comparison every few seconds.

export const WAKE_EVENT = "kasten:wake";

/** How often the beat runs. */
export const BEAT_MS = 10_000;
/** How far from a beat's due time counts as "the computer was away". */
export const GAP_MS = 30_000;

/** Tells the window the time jumped (a sleep, or the clock set). */
export function announceWake(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WAKE_EVENT));
}

/** Listens for `announceWake`; returns how to stop. */
export function onWake(run: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WAKE_EVENT, run);
  return () => window.removeEventListener(WAKE_EVENT, run);
}

/** Starts the beat; returns how to stop. Call once, for the window. */
export function watchWake(beat = BEAT_MS, gap = GAP_MS): () => void {
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const away = now - last - beat;
    last = now;
    if (away > gap || away < -gap) announceWake();
  }, beat);
  return () => clearInterval(timer);
}
