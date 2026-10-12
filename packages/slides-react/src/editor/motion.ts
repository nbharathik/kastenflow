// Whether the editor moves: slides slide into place when they are reordered, handles fade in, a transition is
// previewed. The host decides. Kasten sets `data-motion` on the page (`off` when its motion setting is off, and then
// every duration of its tokens is nothing); with no setting the computer's own "reduce motion" decides. How long a
// thing moves is the host's token too: `--ks-base` on the editor (Kasten maps its `--motion-base` to it).

/** How long a thing the editor moves takes when the host gives no token, in milliseconds. */
export const MOVE_MS = 160;
/** The longer and the shorter times, for the same case. */
export const SLOW_MS = 200;
export const FAST_MS = 90;

/** Whether things move. */
export function motionOn(): boolean {
  if (typeof document === "undefined") return false;
  const setting = document.documentElement.dataset.motion;
  if (setting === "off") return false;
  if (setting === "on") return true;
  return !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** `ms`, or no time at all while nothing moves. */
export function motionMs(ms: number): number {
  return motionOn() ? ms : 0;
}

/** A CSS time such as `140ms` or `0.2s` in milliseconds; null for anything else. */
export function milliseconds(text: string): number | null {
  const match = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === "s" ? value * 1000 : value;
}

/**
 * How long something that moves takes on `node`: the host's `--ks-base` token there, else `MOVE_MS`; nothing while the host's
 * motion is off. A token of nothing (`0ms`, which is what the host's tokens are while its motion setting is off) is nothing.
 */
export function moveMs(node: Element): number {
  return tokenMs(node, "--ks-base", MOVE_MS);
}

/** How long the larger things take (the whole slide's zoom): the host's `--ks-slow`, else `SLOW_MS`; nothing while the host's motion is off. */
export function slowMs(node: Element): number {
  return tokenMs(node, "--ks-slow", SLOW_MS);
}

/** How long a small answer takes (a handle, an outline): the host's `--ks-fast`, else `FAST_MS`; nothing while the host's motion is off. */
export function fastMs(node: Element): number {
  return tokenMs(node, "--ks-fast", FAST_MS);
}

function tokenMs(node: Element, token: string, fallback: number): number {
  if (!motionOn()) return 0;
  let value: number | null = null;
  try {
    value = milliseconds(getComputedStyle(node).getPropertyValue(token));
  } catch {
    // No styles to read: the usual time.
  }
  return Math.max(value ?? fallback, 0);
}

/** The easing of the host's motion tokens (Kasten's `--ease-standard`): quick to start, long to settle. The same curve is `--ks-ease` in the stylesheets. */
export const EASE = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Plays an animation on `node` when there is motion and the browser can (`Element.animate`), and answers it; null otherwise.
 * It never throws: a node that cannot be animated just does not move.
 */
export function play(node: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!motionOn() || typeof node.animate !== "function") return null;
  try {
    return node.animate(keyframes, options);
  } catch {
    return null;
  }
}
