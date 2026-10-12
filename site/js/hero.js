// The banner: an app window with a row of views above it. The page and its
// Markdown file are live from the start; the whiteboard, History and the chat
// start the first time they are opened; the rest are pictures of the app.
//
// On a screen wide and tall enough the window stays pinned on the right while
// the visitor scrolls past a list of steps on the left, and shows one view
// after another: where it is in its track of scrolling picks the view, and the
// step in use lights up. Choosing a tab, or a
// link elsewhere on the page that carries data-view, scrolls to that view's
// place. Elsewhere the window does not scroll and a view is simply opened.

import filesDemo from "./demo-files.js";
import { setupHeroExamples } from "./hero-examples.js";
import { setupHeroTour } from "./hero-motion.js";

const SCROLL_TOUR = "(min-width: 1100px) and (min-height: 640px)";

const LIVE = {
  board: () => import("./demo-board.js"),
  history: () => import("./demo-history.js"),
  ai: () => import("./demo-ai.js"),
};

/** `tour: false` leaves out the intro; `load(name)` fetches a live view's script. */
export function setupHero(root = document.querySelector("[data-hero]"), { tour = true, load = (name) => LIVE[name]() } = {}) {
  if (!root) return;
  const win = root.ownerDocument.defaultView;
  const strip = root.querySelector(".tour-tabs");
  const tabs = [...strip.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => root.querySelector(`#${tab.getAttribute("aria-controls")}`));
  const title = root.querySelector("[data-app-title]");
  const track = root.querySelector("[data-track]");
  const pin = root.querySelector(".tour-pin");
  const started = new Set();

  // Where the window scrolls, each tab becomes a step beside it: the view's own
  // heading and text, taken from its panel so that they are written once.
  tabs.forEach((tab, i) => {
    const head = panels[i].querySelector(".view-head");
    const copy = root.ownerDocument.createElement("span");
    copy.className = "tab-copy";
    const name = copy.appendChild(root.ownerDocument.createElement("span"));
    name.className = "tab-title";
    name.textContent = head.querySelector(".view-title").textContent;
    const text = copy.appendChild(root.ownerDocument.createElement("span"));
    text.className = "tab-text";
    text.innerHTML = head.querySelector("p").innerHTML;
    tab.append(copy);
  });

  let current = 0;
  let held = 0;
  let frame = 0;

  const scrolling = () => root.hasAttribute("data-scroll");

  function start(index) {
    const name = tabs[index].id.replace(/^tab-/, "");
    const el = panels[index].querySelector("[data-demo]");
    if (!(name in LIVE) || !el || started.has(name)) return;
    started.add(name);
    load(name)
      .then((demo) => demo.default(el))
      .catch(() => started.delete(name));
  }

  /** Keeps the chosen view in sight when the tabs scroll sideways. */
  function centre(tab) {
    if (strip.scrollWidth <= strip.clientWidth) return;
    const at = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollTo({ left: at - (strip.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }

  function show(index, focus = false) {
    current = index;
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].classList.toggle("is-active", on);
      panels[i].toggleAttribute("inert", !on);
    });
    title.textContent = tabs[index].dataset.windowTitle;
    if (focus) tabs[index].focus();
    centre(tabs[index]);
    start(index);
  }

  // The track: how far the pinned window has travelled, from 0 as it pins to 1
  // as it lets go.
  const pinTop = () => parseFloat(win.getComputedStyle(pin).top) || 0;
  const room = () => track.getBoundingClientRect().height - pin.offsetHeight;

  function follow() {
    frame = 0;
    if (!scrolling() || held) return;
    const travelled = room() > 0 ? (pinTop() - track.getBoundingClientRect().top) / room() : 0;
    // Each view has its place along the track, the first at the start and the
    // last at the end, and is shown from halfway to the one before it.
    const last = tabs.length - 1;
    const reach = Math.min(last, Math.max(0, travelled * last));
    const index = Math.round(reach);
    track.style.setProperty("--at", reach.toFixed(3));
    if (index !== current) show(index);
  }

  // After choosing a view, the scroll to its place is not read as the visitor
  // picking views on the way; once it settles, the page is read again.
  function hold() {
    win.clearTimeout(held);
    held = win.setTimeout(() => {
      held = 0;
      follow();
    }, 160);
  }

  /** Shows a view, and scrolls to its place in the track where the window scrolls. */
  function go(index, focus = false) {
    show(index, focus);
    if (!scrolling()) return;
    const top = win.scrollY + track.getBoundingClientRect().top - pinTop() + room() * (index / (tabs.length - 1));
    hold();
    win.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const soon = () => {
    if (held) hold();
    else if (!frame) frame = win.requestAnimationFrame(follow);
  };
  win.addEventListener("scroll", soon, { passive: true });
  win.addEventListener("resize", soon);

  const media = matchMedia(SCROLL_TOUR);
  const decide = () => {
    root.toggleAttribute("data-scroll", media.matches);
    soon();
  };
  media.addEventListener?.("change", decide);

  tabs.forEach((tab, i) => tab.addEventListener("click", () => go(i)));
  strip.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    let next;
    if (step) next = (current + step + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    go(next, true);
  });
  root.ownerDocument.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[data-view]");
    const index = tabs.findIndex((tab) => tab.id === `tab-${link?.dataset.view}`);
    if (index < 0) return;
    if (scrolling()) event.preventDefault();
    go(index);
  });

  const pages = root.querySelector("#view-pages");
  const demo = filesDemo(pages.querySelector("[data-demo]"));
  setupHeroExamples(pages, demo);
  if (tour) setupHeroTour(pages, demo);
  show(0);
  root.dataset.ready = "";
  decide();
  follow();
  return { show, demo };
}
