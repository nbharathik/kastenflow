// How what a step brings in comes in. This file has no imports and touches nothing but the
// elements it is given, so the presentation in the app and the exported web page (which pastes
// it in) run the same code.

/** Seconds an effect takes when the deck does not say. */
export const EFFECT_SECONDS = 0.3;

/**
 * The frames an element starts from. Each frame names only where it begins: the browser
 * finishes at the element's own state, so a dimmed element comes in to dimmed, and a turned one
 * stays turned (the separate `translate` and `scale` properties leave `transform` alone).
 */
function framesOf(effect) {
  switch (effect) {
    case "fadeUp":
      return [{ opacity: 0, translate: "0 24px" }];
    case "grow":
      return [{ opacity: 0, scale: 0.85 }];
    case "fade":
      return [{ opacity: 0 }];
    default:
      return null;
  }
}

/** Whether the person asked for less movement: the app's own motion setting (the page says `data-motion="off"`), or their system's. */
function calm() {
  try {
    if (typeof document !== "undefined" && document.documentElement.dataset.motion === "off") return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Brings elements in with an effect: `none`, `fade`, `fadeUp` or `grow`. Does nothing where the browser
 * cannot animate, or the person wants less movement, and the elements are simply there.
 */
export function playEnter(elements, effect, seconds) {
  const frames = framesOf(effect);
  if (!frames || calm()) return;
  const duration = (typeof seconds === "number" && seconds >= 0 ? seconds : EFFECT_SECONDS) * 1000;
  if (duration === 0) return;
  for (const element of elements) {
    if (typeof element.animate !== "function") continue;
    try {
      element.animate(frames, { duration, easing: "ease-out", fill: "backwards" });
    } catch {
      // An element the browser will not animate is just there.
    }
  }
}

/**
 * Notes which elements a slide draws, to tell the new ones: each call answers which of `now` were not there the call before.
 * The first call only learns (a slide that has just appeared has nothing new). Elements are told apart by `keyOf`, the
 * element itself unless a page redraws its slides and keeps a name in each element.
 */
export function newcomers(keyOf = (element) => element) {
  let seen = null;
  return function fresh(now) {
    const found = seen === null ? [] : now.filter((element) => !seen.has(keyOf(element)));
    seen = new Set(now.map((element) => keyOf(element)));
    return found;
  };
}

/**
 * Notes which paragraphs a slide hides (a list that builds line by line), to tell the ones a step has just uncovered: each call
 * answers the paragraphs that were hidden the call before and are not now. The first call only learns.
 */
export function uncovered(keyOf = (paragraph) => paragraph) {
  let hidden = null;
  return function fresh(paragraphs) {
    const now = new Set(paragraphs.filter((p) => p.style.visibility === "hidden").map((p) => keyOf(p)));
    const found = hidden === null ? [] : paragraphs.filter((p) => hidden.has(keyOf(p)) && !now.has(keyOf(p)));
    hidden = now;
    return found;
  };
}
