// What a presentation has besides its slides: the keys, the laser pointer, the box that takes a slide number,
// the list of keys, and the picture shown large. It is written against reveal.js and the DOM alone, without
// imports, so the presentation in the app and the exported web page (which pastes it in) behave alike.

const ROWS = [
  ["→  Space", "Next step, then the next slide"],
  ["←  Shift Space", "Back a step, then the slide before"],
  ["↓  ↑", "Into and out of the backup slides"],
  ["O", "Overview of all the slides"],
  ["1 2 … Enter", "Go to a slide by its number"],
  ["B", "Black screen"],
  ["L", "Laser pointer"],
  ["F", "Full screen"],
  ["?", "This list"],
];

const DIGITS = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105];

function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The slide's picture, shown as large as the window allows, until it is clicked or Esc is pressed. */
function openLightbox(doc, host, image, onClosed) {
  const box = make(doc, "div", "ks-show-lightbox");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", image.alt || "Picture");
  const large = doc.createElement("img");
  large.src = image.currentSrc || image.src;
  large.alt = image.alt || "";
  box.append(large);
  if (image.alt) box.append(make(doc, "p", "ks-show-lightbox-caption", image.alt));
  const win = doc.defaultView;
  const close = () => {
    win.removeEventListener("keydown", onKey, true);
    box.remove();
    onClosed();
  };
  // While a picture is up no key reaches the deck, and Esc, Enter and Space put it away.
  function onKey(event) {
    event.stopImmediatePropagation();
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      close();
    }
  }
  box.addEventListener("click", close);
  win.addEventListener("keydown", onKey, true);
  host.append(box);
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
  return close;
}

/**
 * Gives a running reveal.js the presentation's keys and tools.
 *
 * @param {object} reveal a started reveal.js
 * @param {HTMLElement} host an empty element inside the deck's window to put the tools in
 * @param {object} [options]
 * @param {(number: number) => [number, number] | null} [options.locate] the column and row of a slide by its number, from 1
 * @param {() => void} [options.onExit] what Esc does when nothing else is open; without it Esc leaves nothing
 * @param {() => void} [options.onPresenter] what S does
 * @param {() => void} [options.fullscreen] what F does; the page's full screen when left out
 * @param {HTMLElement} [options.fullscreenTarget] what F fills when it is the page's own full screen
 * @param {number} [options.hintSeconds] how long the line of keys shows at the start; 0 for never
 * @returns {{ destroy(): void, laser(on?: boolean): boolean, hints(on?: boolean): boolean, lightboxOpen(): boolean }}
 */
export function attachChrome(reveal, host, options = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const bound = [];
  let laserOn = false;
  let typed = "";
  let typedTimer = 0;
  let hintsBox = null;
  let closeLightbox = null;

  const dot = make(doc, "div", "ks-show-laser");
  dot.hidden = true;
  const jumpBox = make(doc, "div", "ks-show-jump");
  jumpBox.setAttribute("role", "status");
  jumpBox.hidden = true;
  host.append(dot, jumpBox);

  const bind = (codes, run) => {
    for (const code of codes) {
      reveal.addKeyBinding(code, run);
      bound.push(code);
    }
  };

  // The laser pointer: a red dot at the pointer, and no other pointer.
  const move = (event) => {
    dot.hidden = false;
    dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  };
  const laser = (on = !laserOn) => {
    laserOn = on;
    (host.parentElement ?? host).classList.toggle("ks-show-laser-on", on);
    dot.hidden = true;
    if (on) win.addEventListener("pointermove", move);
    else win.removeEventListener("pointermove", move);
    return laserOn;
  };

  // A slide number typed on the keys, gone to with Enter.
  const clearTyped = () => {
    typed = "";
    jumpBox.hidden = true;
    win.clearTimeout(typedTimer);
  };
  const type = (digit) => {
    typed = (typed + digit).slice(0, 4);
    jumpBox.textContent = `Go to slide ${typed}  ↵`;
    jumpBox.hidden = false;
    win.clearTimeout(typedTimer);
    typedTimer = win.setTimeout(clearTyped, 4000);
  };
  const go = () => {
    const target = options.locate?.(Number(typed));
    clearTyped();
    if (target) {
      if (reveal.isOverview()) reveal.toggleOverview(false);
      reveal.slide(target[0], target[1]);
    }
  };

  // The list of keys.
  const hints = (on = hintsBox === null) => {
    if (on && hintsBox === null) {
      const rows = [...ROWS, ...(options.onPresenter ? [["S", "Presenter view"]] : []), ...(options.onExit ? [["Esc", "Close what is open, then leave"]] : [])];
      hintsBox = make(doc, "div", "ks-show-hints");
      hintsBox.setAttribute("role", "dialog");
      hintsBox.setAttribute("aria-label", "Keyboard shortcuts");
      hintsBox.append(make(doc, "h2", "ks-show-hints-title", "Keys"));
      const list = make(doc, "dl", "ks-show-hints-list");
      for (const [keys, what] of rows) list.append(make(doc, "dt", "ks-show-hints-keys", keys), make(doc, "dd", "ks-show-hints-what", what));
      hintsBox.append(list);
      hintsBox.addEventListener("click", () => hints(false));
      host.append(hintsBox);
    } else if (!on && hintsBox !== null) {
      hintsBox.remove();
      hintsBox = null;
    }
    return hintsBox !== null;
  };

  const fill = () => {
    if (options.fullscreen) return options.fullscreen();
    if (doc.fullscreenElement) void doc.exitFullscreen?.();
    else void (options.fullscreenTarget ?? doc.documentElement).requestFullscreen?.().catch(() => {});
  };

  const advance = (event) => {
    if (reveal.isOverview()) reveal.toggleOverview(false);
    if (event.shiftKey) reveal.left();
    else reveal.right();
  };

  bind([32], advance);
  // A clicker's page keys and N and P mean the next slide and the last: never into the backup slides.
  bind([34, 78], () => reveal.right());
  bind([33, 80], () => reveal.left());
  bind([40], (event) => {
    if (reveal.hasVerticalSlides()) reveal.down({ skipFragments: !event.altKey });
    else reveal.next({ skipFragments: event.altKey });
  });
  bind([38], (event) => {
    if (reveal.hasVerticalSlides()) reveal.up({ skipFragments: !event.altKey });
    else reveal.prev({ skipFragments: event.altKey });
  });
  bind([76], () => laser());
  bind([70], fill);
  bind([83], () => options.onPresenter?.());
  // "/" alone is a clicker's black-screen button; with Shift it is "?".
  bind([63, 191], (event) => (event.keyCode === 191 && !event.shiftKey ? reveal.togglePause() : hints()));
  bind(DIGITS, (event) => type(String(event.keyCode >= 96 ? event.keyCode - 96 : event.keyCode - 48)));
  bind([13], () => {
    if (typed !== "") go();
    else if (reveal.isOverview()) reveal.toggleOverview(false);
  });
  bind([27], () => {
    if (hintsBox !== null) hints(false);
    else if (typed !== "") clearTyped();
    else if (reveal.isOverview()) reveal.toggleOverview(false);
    else options.onExit?.();
  });

  // A click on a picture shows it large (a click in the overview chooses the slide instead).
  const slides = reveal.getSlidesElement();
  const onClick = (event) => {
    const target = event.target;
    const image = target instanceof win.Element ? target.closest("img.ks-image-pic") : null;
    if (!image || reveal.isOverview() || closeLightbox) return;
    closeLightbox = openLightbox(doc, host, image, () => {
      closeLightbox = null;
    });
  };
  slides?.addEventListener("click", onClick);

  // The arrows show while the pointer moves, and go when it rests.
  const stage = host.parentElement;
  let restTimer = 0;
  let wokeAt = 0;
  const wake = () => {
    // A pointer moves many times a frame; the timer is set again a few times a second, not for each step.
    const now = win.performance.now();
    if (now - wokeAt < 200 && stage?.classList.contains("is-active")) return;
    wokeAt = now;
    stage?.classList.add("is-active");
    win.clearTimeout(restTimer);
    restTimer = win.setTimeout(() => stage?.classList.remove("is-active"), 2500);
  };
  win.addEventListener("pointermove", wake);

  let hintTimer = 0;
  let hintBar = null;
  const seconds = options.hintSeconds ?? 4;
  if (seconds > 0) {
    hintBar = make(doc, "div", "ks-show-hintbar", "← → next and back   ·   O overview   ·   B black   ·   L laser   ·   ? all keys");
    host.append(hintBar);
    hintTimer = win.setTimeout(() => hintBar?.classList.add("is-gone"), seconds * 1000);
  }

  return {
    laser,
    hints,
    lightboxOpen: () => closeLightbox !== null,
    destroy() {
      for (const code of bound) reveal.removeKeyBinding(code);
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointermove", wake);
      win.clearTimeout(restTimer);
      win.clearTimeout(typedTimer);
      win.clearTimeout(hintTimer);
      slides?.removeEventListener("click", onClick);
      closeLightbox?.();
      hintsBox?.remove();
      hintBar?.remove();
      dot.remove();
      jumpBox.remove();
      (host.parentElement ?? host).classList.remove("ks-show-laser-on");
    },
  };
}
