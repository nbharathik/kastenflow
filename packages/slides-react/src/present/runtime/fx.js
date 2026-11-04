// The effects of the steps of a slide: an element that comes in, goes out or draws the eye when a click brings its step. This file
// has no imports and touches nothing but the elements it is given, so the presentation in the app and the exported web page (which
// pastes it in) run the same code. Only transform, opacity and clip-path move. With less movement asked for, what comes in or goes out
// fades, and what only draws the eye does nothing.

/** Seconds an effect takes when it does not say. */
export const FX_SECONDS = 0.4;

/** The side something comes from, as a step of x and of y. */
const SIDES = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

function calm() {
  try {
    if (typeof document !== "undefined" && document.documentElement.dataset.motion === "off") return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * The frame an element starts from when it comes in (the browser finishes at the element's own look, so a dimmed element comes in to
 * dimmed); null for an effect with nothing to see. `reach` is how far the element is from each edge of its slide, in the slide's units.
 */
export function startFrame(fx, reach) {
  const side = SIDES[fx.direction] ? fx.direction : "down";
  const [x, y] = SIDES[side];
  switch (fx.kind) {
    case "fade":
      return { opacity: 0 };
    case "fadeUp":
      return { opacity: 0, translate: "0 24px" };
    case "grow":
      return { opacity: 0, scale: 0.85 };
    case "fly": {
      const away = (name) => (reach && Number.isFinite(reach[name]) ? reach[name] : 400);
      const from = x < 0 ? `${-away("left")}px 0` : x > 0 ? `${away("right")}px 0` : y < 0 ? `0 ${-away("up")}px` : `0 ${away("down")}px`;
      return { translate: from };
    }
    case "zoom":
      return { scale: 0.1, opacity: 0 };
    case "wipe":
      return { clipPath: x > 0 ? "inset(0 0 0 100%)" : x < 0 ? "inset(0 100% 0 0)" : y < 0 ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)" };
    case "float":
      return { opacity: 0, translate: `${x * 40}px ${y * 40}px` };
    case "pop":
      return { opacity: 0, scale: 0.7 };
    case "path":
      return { translate: `${Number(fx.dx) || 0}px ${Number(fx.dy) || 0}px` };
    default:
      return null;
  }
}

/**
 * When each effect of one click begins, in milliseconds from the click: the first begins with the click, one that is "with" the effect
 * before it begins when that one does, and one that is "after" begins when that one ends. Each adds its own delay.
 */
export function schedule(effects) {
  const out = [];
  let begin = 0;
  let previousEnd = 0;
  effects.forEach((fx, i) => {
    const seconds = typeof fx.duration === "number" && fx.duration >= 0 ? fx.duration : FX_SECONDS;
    const wait = (typeof fx.delay === "number" && fx.delay > 0 ? fx.delay : 0) * 1000;
    if (i > 0 && fx.start === "after") begin = previousEnd;
    const at = begin + wait;
    out.push({ at, ms: seconds * 1000 });
    previousEnd = at + seconds * 1000;
  });
  return out;
}

/** How far an element is from each edge of its slide, in the slide's own units (its frame may be scaled to the screen). */
export function reachOf(element) {
  const slide = element.closest?.(".ks-slide") ?? element.parentElement;
  if (!slide || typeof slide.getBoundingClientRect !== "function") return null;
  const s = slide.getBoundingClientRect();
  const r = element.getBoundingClientRect();
  const k = slide.offsetWidth > 0 && s.width > 0 ? s.width / slide.offsetWidth : 1;
  return { left: (r.right - s.left) / k, right: (s.right - r.left) / k, up: (r.bottom - s.top) / k, down: (s.bottom - r.top) / k };
}

/** A wash of colour over an element that fades: the element itself keeps its look. */
function flash(element, color, ms, delay) {
  const doc = element.ownerDocument;
  const wash = doc.createElement("div");
  wash.setAttribute("aria-hidden", "true");
  wash.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${color};opacity:0;border-radius:inherit;`;
  if (getComputedStyle(element).position === "static") element.style.position = "relative";
  element.append(wash);
  const animation = wash.animate([{ opacity: 0 }, { opacity: 0.5, offset: 0.4 }, { opacity: 0 }], { duration: ms, delay, easing: "ease-in-out", fill: "both" });
  animation.addEventListener?.("finish", () => wash.remove());
  animation.addEventListener?.("cancel", () => wash.remove());
  return animation;
}

/**
 * Plays the effects of one click. Each item is `{ element, role, fx, done? }`, in the order the slide lists them: `role` is "enter",
 * "exit" or "emph", `fx` the effect (`kind`, `direction`, `duration`, `delay`, `start`, `color`, `dx`, `dy`) and `done` is called when
 * an exit has finished. Answers the animations started.
 */
export function playFx(items) {
  const less = calm();
  const started = [];
  const times = schedule(items.map((item) => item.fx));
  items.forEach((item, i) => {
    const { element, role, fx } = item;
    const { at, ms } = times[i];
    if (!element || typeof element.animate !== "function") {
      item.done?.();
      return;
    }
    try {
      if (fx.kind === "colour" || fx.kind === "pulse") {
        if (less) return;
        if (fx.kind === "pulse") {
          started.push(element.animate([{ scale: 1 }, { scale: 1.1, offset: 0.5 }, { scale: 1 }], { duration: ms, delay: at, easing: "ease-in-out" }));
        } else {
          started.push(flash(element, fx.color || "currentColor", ms, at));
        }
        return;
      }
      const frame = less ? (fx.kind === "appear" ? null : { opacity: 0 }) : startFrame(fx, reachOf(element));
      if (!frame) {
        item.done?.();
        return;
      }
      const animation = element.animate([frame], role === "exit" ? { duration: ms, delay: at, easing: "ease-in", direction: "reverse", fill: "both" } : { duration: ms, delay: at, easing: "ease-out", fill: "backwards" });
      if (role === "exit") {
        animation.addEventListener?.("finish", () => item.done?.());
        animation.addEventListener?.("cancel", () => item.done?.());
      }
      started.push(animation);
    } catch {
      // An element the browser will not animate is just there.
      item.done?.();
    }
  });
  return started;
}

/**
 * Remembers copies of the elements that will go out (the ones `wants` names by key): each call answers what was there the call before
 * and is not now, as `{ key, clone, parent }`, so that it can be drawn once more while it goes. The first call only learns.
 */
export function departures(keyOf, wants) {
  let seen = null;
  return function gone(now) {
    const keys = new Set(now.map((element) => keyOf(element)));
    const left = seen === null ? [] : [...seen.values()].filter((entry) => !keys.has(entry.key));
    seen = new Map();
    for (const element of now) {
      const key = keyOf(element);
      if (wants(key)) seen.set(key, { key, clone: element.cloneNode(true), parent: element.parentElement });
    }
    return left;
  };
}

/**
 * The player of one slide's effects. `plan` is `{ [step]: [{ id, role, fx }] }` in the order the slide lists them. `play(drawn, host,
 * step, live)` is told the elements the slide draws now (each with a `data-el`) and the element they stand in; it plays the effects of
 * `step` when the slide has moved on to it and is the slide on view, and answers the ids of the elements it took care of, which the slide's usual effect leaves alone.
 */
export function fxPlayer(plan) {
  const exits = new Set();
  for (const list of Object.values(plan ?? {})) for (const entry of list) if (entry.role === "exit") exits.add(entry.id);
  const keyOf = (element) => element.getAttribute("data-el");
  const gone = departures(keyOf, (key) => exits.has(key));
  let last = null;
  return {
    play(drawn, host, step, live = true) {
      const ghosts = new Map(gone(drawn).map((entry) => [entry.key, entry]));
      const before = last;
      last = step;
      const entries = live && before !== null && step > before ? (plan?.[step] ?? []) : [];
      const byId = new Map();
      for (const element of drawn) if (!byId.has(keyOf(element))) byId.set(keyOf(element), element);
      const items = [];
      const handled = new Set();
      for (const entry of entries) {
        handled.add(entry.id);
        if (entry.role === "exit") {
          const ghost = ghosts.get(entry.id);
          if (!ghost || !host) continue;
          const home = ghost.parent?.isConnected ? ghost.parent : host;
          ghost.clone.style.pointerEvents = "none";
          home.append(ghost.clone);
          items.push({ element: ghost.clone, role: "exit", fx: entry.fx, done: () => ghost.clone.remove() });
        } else {
          const element = byId.get(entry.id);
          if (element) items.push({ element, role: entry.role, fx: entry.fx });
        }
      }
      if (items.length > 0) playFx(items);
      return handled;
    },
  };
}
