// Morph: a slide arrives with its elements moving from where the slide before had them. reveal.js's Auto-Animate
// finds the two slides and pairs their elements by `data-id` (an element's `morphId`, else its id); this file says
// which pairs those are and does the animating with the browser's animations, so that turned and flipped elements,
// colours and changed words are all handled. It has no imports, so the presentation in the app and the exported web
// page (which pastes it in) morph alike.
//
// Wire it up with `autoAnimateMatcher: matchSlides` in reveal.js's settings and `reveal.on("autoanimate", animateMorph)`.

const ID = "data-id";

/** What is worked out when reveal.js asks for the pairs, kept for the moment it says the animation starts. */
const found = new WeakMap();

/** The paint of an element that changes colour, in the names the browser's animations use. */
const PAINT = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "fill", "stroke", "strokeWidth"];

/** Whether the person asked for less movement: the app's own motion setting (the page says `data-motion="off"`), or their system's. */
function calm() {
  try {
    if (typeof document !== "undefined" && document.documentElement.dataset.motion === "off") return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Where an element is laid out on its slide, in slide units: turns and the deck's scale do not move it. */
function boxOf(node) {
  return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
}

/** What an element says: its words and its pictures. Two elements that say the same thing are one thing that moved. */
function saysOf(node) {
  const pictures = [...node.querySelectorAll("img")].map((image) => image.getAttribute("src") || image.getAttribute("data-ks-img") || "");
  return `${node.textContent}\u0000${pictures.join("\u0000")}`;
}

/** The nodes of a list that have no other node of the list above them. */
function topmost(nodes) {
  const all = new Set(nodes);
  return nodes.filter((node) => {
    for (let up = node.parentElement; up; up = up.parentElement) if (all.has(up)) return false;
    return true;
  });
}

/**
 * The pairs of elements to animate between two slides, in the form reveal.js's `autoAnimateMatcher` gives. Elements are
 * paired by `data-id`, in order when the same id is on more than one. reveal.js is told to animate nothing itself.
 */
export function matchSlides(fromSlide, toSlide) {
  const before = new Map();
  for (const node of fromSlide.querySelectorAll(`[${ID}]`)) {
    const id = node.getAttribute(ID);
    if (!before.has(id)) before.set(id, []);
    before.get(id).push(node);
  }
  const pairs = [];
  const added = [];
  for (const node of toSlide.querySelectorAll(`[${ID}]`)) {
    const match = before.get(node.getAttribute(ID))?.shift();
    if (match) pairs.push({ from: match, to: node });
    else added.push(node);
  }
  const removed = [...before.values()].flat();
  found.set(toSlide, { pairs, added, removed });
  return pairs.map(({ from, to }) => ({ from, to, options: { translate: false, scale: false, styles: [] } }));
}

/** The paint that differs between two elements drawn the same way: what a recolouring animates. */
function paintChanges(from, to) {
  const a = [from, ...from.querySelectorAll("*")];
  const b = [to, ...to.querySelectorAll("*")];
  const same = a.length === b.length && a.every((node, i) => node.tagName === b[i].tagName);
  if (!same) return [];
  const changes = [];
  a.forEach((node, i) => {
    const before = getComputedStyle(node);
    const after = getComputedStyle(b[i]);
    const differs = PAINT.filter((property) => before[property] !== after[property] && before[property] && after[property]);
    if (differs.length > 0) changes.push([b[i], Object.fromEntries(differs.map((property) => [property, [before[property], after[property]]]))]);
  });
  return changes;
}

/** A copy of an element that stays where it was drawn, to fade out over the slide that replaced it. */
function ghostOf(node, into) {
  const copy = node.cloneNode(true);
  copy.removeAttribute(ID);
  copy.removeAttribute("data-el");
  copy.setAttribute("aria-hidden", "true");
  copy.style.pointerEvents = "none";
  into.append(copy);
  return copy;
}

function ghostAnimation(ghost, keyframes, options) {
  const done = () => ghost.remove();
  try {
    const animation = ghost.animate(keyframes, { ...options, fill: "forwards" });
    animation.addEventListener("finish", done);
    animation.addEventListener("cancel", done);
  } catch {
    done();
  }
}

/**
 * What it takes to bring one element in from where its pair was: how it moves and resizes, whether its words changed, and
 * what changes colour. This only reads the page (so that reading everything first costs one layout, and not one for each pair).
 */
function measure(from, to) {
  const a = boxOf(from);
  const b = boxOf(to);
  let sx = b.w > 0 && a.w > 0 ? a.w / b.w : 1;
  let sy = b.h > 0 && a.h > 0 ? a.h / b.h : 1;
  // Words are not stretched: a box that changes shape scales by the same amount both ways.
  if (to.getAttribute("data-type") === "text") sx = sy = Math.sqrt(sx * sy);
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  const before = Number(getComputedStyle(from).opacity);
  const after = Number(getComputedStyle(to).opacity);
  const changed = saysOf(from) !== saysOf(to);
  return { from, to, sx, sy, dx, dy, before, after, changed, paint: changed ? [] : paintChanges(from, to) };
}

/** Starts the animations of one element that `measure` described. */
function moveInto({ from, to, sx, sy, dx, dy, before, after, changed, paint }, options) {
  const frames = {};
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) frames.translate = [`${dx}px ${dy}px`, "0px 0px"];
  if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) frames.scale = [`${sx} ${sy}`, "1 1"];
  if (changed) frames.opacity = [0, after];
  else if (before !== after) frames.opacity = [before, after];
  if (Object.keys(frames).length > 0) to.animate(frames, { ...options, fill: "backwards" });

  if (changed) {
    // The old words stay, and go the way the element goes, fading as the new ones come.
    const ghost = ghostOf(from, to.parentElement);
    const carry = { opacity: [before, 0] };
    if (frames.translate) carry.translate = ["0px 0px", `${-dx}px ${-dy}px`];
    if (frames.scale) carry.scale = ["1 1", `${1 / sx} ${1 / sy}`];
    ghostAnimation(ghost, carry, options);
    return;
  }
  for (const [node, changes] of paint) node.animate(changes, { ...options, fill: "backwards" });
}

/**
 * Runs the morph between two slides: reveal.js's "autoanimate" event has found the pair of slides, and this moves
 * every paired element from its place on the slide before to its own, fades in the ones that are new (a little
 * later), and fades out the ones that are gone. What is measured is read first and the animations started after, so
 * the page is laid out once.
 */
export function animateMorph(event) {
  const { fromSlide, toSlide } = event;
  const plan = found.get(toSlide);
  found.delete(toSlide);
  if (!plan || calm() || typeof toSlide.animate !== "function") return;
  // The slide that morphs is the later of the two, whichever way the person is going: it says how long and how.
  const later = fromSlide.compareDocumentPosition(toSlide) & 4 ? toSlide : fromSlide;
  const seconds = Number.parseFloat(later.getAttribute("data-auto-animate-duration") ?? "") || 0.6;
  const easing = later.getAttribute("data-auto-animate-easing") || "ease";
  const options = { duration: seconds * 1000, easing };
  const stage = toSlide.querySelector(".ks-slide");
  const oldStage = fromSlide.querySelector(".ks-slide");

  const moves = [];
  for (const { from, to } of plan.pairs) {
    try {
      moves.push(measure(from, to));
    } catch {
      // One element that cannot be measured does not stop the others.
    }
  }
  const arriving = topmost(plan.added).map((node) => [node, Number(getComputedStyle(node).opacity)]);
  const leaving = stage ? topmost(plan.removed).map((node) => [node, Number(getComputedStyle(node).opacity)]) : [];
  const paperBefore = oldStage ? getComputedStyle(oldStage).backgroundColor : "";
  const paperAfter = stage ? getComputedStyle(stage).backgroundColor : "";

  for (const move of moves) {
    try {
      moveInto(move, options);
    } catch {
      // One element that will not animate does not stop the others.
    }
  }
  const late = { duration: seconds * 800, delay: seconds * 200, easing, fill: "backwards" };
  for (const [node, opacity] of arriving) node.animate({ opacity: [0, opacity] }, late);
  if (stage) {
    for (const [node, opacity] of leaving) ghostAnimation(ghostOf(node, stage), { opacity: [opacity, 0] }, { duration: seconds * 800, easing });
    // The paper changes colour as the elements move.
    if (paperBefore && paperBefore !== paperAfter) stage.animate({ backgroundColor: [paperBefore, paperAfter] }, { ...options, fill: "backwards" });
  }
}
