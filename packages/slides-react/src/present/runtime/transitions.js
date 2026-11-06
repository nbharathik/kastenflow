// How a slide arrives when the transition is one reveal.js has no name for (push, wipe, cover, uncover, zoom, flip, dissolve). This
// file has no imports and touches nothing but the slides it is given, so the presentation in the app, the exported web page
// (which pastes it in) and the editor's preview run the same code. Only transform, opacity and clip-path move; with less
// movement asked for, every one of them is a cross-fade.

/** The kinds this file plays; reveal.js plays the rest (it is told "none" for these). */
export const KINDS = ["push", "wipe", "cover", "uncover", "zoom", "flip", "dissolve"];

/** The side a motion comes from, as a step of x and of y. */
const SIDES = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const OPPOSITE = { left: "right", right: "left", up: "down", down: "up" };

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
 * What each slide does. `enter` is the keyframes of the slide that arrives and `leave` of the one that goes (both always there, as a
 * hold when the slide only waits), and `top` says which of them is drawn over the other. `direction` is the side the arriving slide
 * comes from; going back along the deck turns it round.
 */
export function framesOf(kind, direction, back, less) {
  const hold = [{ opacity: 1 }, { opacity: 1 }];
  const fade = { enter: [{ opacity: 0 }, { opacity: 1 }], leave: [{ opacity: 1 }, { opacity: 0 }], top: "enter", easing: "linear" };
  if (less) return fade;
  let side = SIDES[direction] ? direction : "right";
  if (back) side = OPPOSITE[side];
  const [x, y] = SIDES[side];
  const at = (n) => `${x * n}% ${y * n}%`;
  const rest = "0% 0%";
  switch (kind) {
    case "push":
      return { enter: [{ translate: at(100) }, { translate: rest }], leave: [{ translate: rest }, { translate: at(-100) }], top: "enter", easing: "cubic-bezier(0.2, 0, 0, 1)" };
    case "cover":
      return { enter: [{ translate: at(100) }, { translate: rest }], leave: hold, top: "enter", easing: "cubic-bezier(0.2, 0, 0, 1)" };
    case "uncover":
      return { enter: hold, leave: [{ translate: rest }, { translate: at(100) }], top: "leave", easing: "cubic-bezier(0.2, 0, 0, 1)" };
    case "wipe": {
      // The picture is uncovered from the side it comes from: the part that shows grows from that edge.
      const cut = x > 0 ? "inset(0 0 0 100%)" : x < 0 ? "inset(0 100% 0 0)" : y < 0 ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)";
      return { enter: [{ clipPath: cut }, { clipPath: "inset(0 0 0 0)" }], leave: hold, top: "enter", easing: "ease-in-out" };
    }
    case "zoom":
      return {
        enter: [{ scale: "0.6", opacity: 0 }, { scale: "1", opacity: 1 }],
        leave: [{ scale: "1", opacity: 1 }, { scale: "1.25", opacity: 0 }],
        top: "enter",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      };
    case "flip": {
      // Half a turn: the old slide turns edge-on, then the new one turns out of it.
      const axis = x !== 0 ? "Y" : "X";
      const turn = (x !== 0 ? x : -y) * 90;
      return {
        enter: [
          { transform: `perspective(1600px) rotate${axis}(${turn}deg)`, opacity: 0, offset: 0 },
          { transform: `perspective(1600px) rotate${axis}(${turn}deg)`, opacity: 0, offset: 0.5 },
          { transform: `perspective(1600px) rotate${axis}(0deg)`, opacity: 1, offset: 1 },
        ],
        leave: [
          { transform: `perspective(1600px) rotate${axis}(0deg)`, opacity: 1, offset: 0 },
          { transform: `perspective(1600px) rotate${axis}(${-turn}deg)`, opacity: 0, offset: 0.5 },
          { transform: `perspective(1600px) rotate${axis}(${-turn}deg)`, opacity: 0, offset: 1 },
        ],
        top: "enter",
        easing: "ease-in-out",
      };
    }
    case "dissolve":
      return fade;
    default:
      return null;
  }
}

/**
 * Plays a transition between two slides (elements) once. Answers the animations started, so the caller can stop them. The slide
 * that goes is held on view while it does (reveal.js has already hidden it), and the one drawn over the other is raised for the
 * time it takes.
 *
 * @param {Element | null} entering the slide that arrives
 * @param {Element | null} leaving the slide that goes, if there is one on view
 * @param {{ kind: string, direction?: string | null, seconds: number, back?: boolean }} spec
 */
export function playTransition(entering, leaving, spec) {
  const frames = framesOf(spec.kind, spec.direction ?? "right", spec.back === true, calm());
  const duration = (typeof spec.seconds === "number" && spec.seconds > 0 ? spec.seconds : 0) * 1000;
  if (!frames || duration === 0) return [];
  const started = [];
  const run = (node, keyframes, raised) => {
    if (!node || typeof node.animate !== "function") return;
    // The slide that goes is hidden by reveal.js at once; it stays on view for the time it takes.
    const shown = keyframes.map((frame) => ({ visibility: "visible", ...frame }));
    try {
      const animation = node.animate(shown, { duration, easing: frames.easing, fill: "backwards" });
      node.style.zIndex = raised ? "2" : "1";
      const done = () => {
        node.style.zIndex = "";
      };
      animation.addEventListener?.("finish", done);
      animation.addEventListener?.("cancel", done);
      started.push(animation);
    } catch {
      // A slide the browser will not animate is just there.
    }
  };
  run(entering, frames.enter, frames.top === "enter");
  run(leaving, frames.leave, frames.top === "leave");
  return started;
}

/** What a section says about how it arrives (the page and the app write these attributes the same way). */
export function specOf(section) {
  const kind = section.getAttribute("data-ks-fx");
  if (!kind || !KINDS.includes(kind)) return null;
  const seconds = Number.parseFloat(section.getAttribute("data-ks-seconds") ?? "");
  return { kind, direction: section.getAttribute("data-ks-dir"), seconds: Number.isFinite(seconds) ? seconds : 0.4 };
}

/**
 * The listener of reveal.js's "slidechanged": plays the arriving slide's transition when it is one of the kinds above. It
 * remembers where the person was, to turn the motion round when they go back.
 */
export function transitionListener() {
  let last = null;
  return function listen(event) {
    const here = [event.indexh ?? 0, event.indexv ?? 0];
    const was = last;
    last = here;
    const to = event.currentSlide;
    const from = event.previousSlide;
    if (!to || !from || to === from) return [];
    const spec = specOf(to);
    if (!spec) return [];
    const back = was !== null && (here[0] < was[0] || (here[0] === was[0] && here[1] < was[1]));
    return playTransition(to, from, { ...spec, back });
  };
}
