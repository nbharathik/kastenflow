// Motion: whether menus, dialogs and views move as they open and close.
// Settings offers System (follow the computer's "reduce motion"), On and
// Off. The result goes on <html> as `data-motion`, where the CSS reads it
// (styles.css sets every duration to nothing while it is off), and
// motionMs() gives scripted animations, such as a whiteboard's zoom, their
// length. Typing never animates, whatever the setting.

export type MotionPref = "system" | "on" | "off";
export const MOTION_PREFS: readonly MotionPref[] = ["system", "on", "off"];

const REDUCE = "(prefers-reduced-motion: reduce)";

function systemStill(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches;
}

/** Whether things move under `pref`. */
export function motionOn(pref: MotionPref): boolean {
  return pref === "on" || (pref === "system" && !systemStill());
}

/** Puts `pref`'s answer on the page. */
export function applyMotion(pref: MotionPref): void {
  const root = document.documentElement.dataset;
  const on = motionOn(pref);
  root.motion = on ? "on" : "off";
  // The computer asked for less (rather than the setting saying Off): the
  // CSS swaps movement for short fades instead of stopping everything.
  if (!on && pref === "system") root.motionReduced = "";
  else delete root.motionReduced;
}

/** `ms`, or no time at all while motion is off. */
export function motionMs(ms: number): number {
  return document.documentElement.dataset.motion === "off" ? 0 : ms;
}

/** Applies the setting again when the computer's own changes; returns the
 * way to stop listening. */
export function watchSystemMotion(pref: () => MotionPref): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCE);
  const changed = () => applyMotion(pref());
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

/** Puts `data-window="hidden"` on <html> while the window is not shown (minimised, another desktop,
 * locked screen); motion.css pauses every animation under it, so nothing runs for no one. Returns how to stop. */
export function watchHidden(): () => void {
  const apply = () => {
    const root = document.documentElement.dataset;
    if (document.visibilityState === "hidden") root.window = "hidden";
    else delete root.window;
  };
  apply();
  document.addEventListener("visibilitychange", apply);
  return () => {
    document.removeEventListener("visibilitychange", apply);
    delete document.documentElement.dataset.window;
  };
}

/** How a scroll the app starts moves: smoothly, or at once while motion is off. */
export function scrollMotion(): ScrollBehavior {
  return motionMs(1) ? "smooth" : "auto";
}
