import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachChrome } from "./chrome.js";

/** What reveal.js gives the tools, as far as they use it. */
function fakeReveal() {
  const bindings = new Map<number, (event: Partial<KeyboardEvent>) => void>();
  const slides = document.createElement("div");
  const state = { overview: false, vertical: false };
  const calls: string[] = [];
  const reveal = {
    addKeyBinding: (code: number, run: (event: Partial<KeyboardEvent>) => void) => void bindings.set(code, run),
    removeKeyBinding: (code: number) => void bindings.delete(code),
    getSlidesElement: () => slides,
    isOverview: () => state.overview,
    toggleOverview: (on?: boolean) => void (state.overview = on ?? !state.overview),
    hasVerticalSlides: () => state.vertical,
    slide: (h: number, v: number) => void calls.push(`slide:${h},${v}`),
    left: () => void calls.push("left"),
    right: () => void calls.push("right"),
    up: (options?: unknown) => void calls.push(`up:${JSON.stringify(options)}`),
    down: (options?: unknown) => void calls.push(`down:${JSON.stringify(options)}`),
    next: (options?: unknown) => void calls.push(`next:${JSON.stringify(options)}`),
    prev: (options?: unknown) => void calls.push(`prev:${JSON.stringify(options)}`),
    togglePause: () => void calls.push("pause"),
  };
  return { reveal, bindings, slides, state, calls, press: (code: number, event: Partial<KeyboardEvent> = {}) => bindings.get(code)?.({ keyCode: code, shiftKey: false, altKey: false, ...event }) };
}

let stage: HTMLElement;
let host: HTMLElement;

beforeEach(() => {
  stage = document.createElement("div");
  host = document.createElement("div");
  stage.append(host);
  document.body.append(stage);
});

afterEach(() => {
  stage.remove();
  vi.useRealTimers();
});

const start = (options: Parameters<typeof attachChrome>[2] = {}) => {
  const fake = fakeReveal();
  const chrome = attachChrome(fake.reveal as never, host, { hintSeconds: 0, ...options });
  return { ...fake, chrome };
};

describe("the keys", () => {
  it("bind and unbind cleanly", () => {
    const { bindings, chrome } = start();
    expect([...bindings.keys()].sort((a, b) => a - b)).toEqual([13, 27, 32, 33, 34, 38, 40, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 63, 70, 76, 78, 80, 83, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 116, 191]);
    chrome.destroy();
    expect(bindings.size).toBe(0);
    expect(host.children).toHaveLength(0);
  });

  it("take F5 without moving, so that it never reloads the page the show is in", () => {
    const { press, calls } = start();
    press(116);
    expect(calls).toEqual([]);
  });

  it("make Space a step or a slide, and Shift Space the way back, closing the overview first", () => {
    const { press, calls, state } = start();
    press(32);
    press(32, { shiftKey: true });
    expect(calls).toEqual(["right", "left"]);
    state.overview = true;
    press(32);
    expect(state.overview).toBe(false);
  });

  it("make a clicker's page keys and N and P the next slide and the last, never a backup slide", () => {
    const { press, calls } = start();
    for (const code of [34, 78]) press(code);
    for (const code of [33, 80]) press(code);
    expect(calls).toEqual(["right", "right", "left", "left"]);
  });

  it("make down and up go through the backup slides without going through steps, or next and last without any", () => {
    const { press, calls, state } = start();
    state.vertical = true;
    press(40);
    press(38);
    press(40, { altKey: true });
    state.vertical = false;
    press(40);
    press(38);
    expect(calls).toEqual(['down:{"skipFragments":true}', 'up:{"skipFragments":true}', 'down:{"skipFragments":false}', 'next:{"skipFragments":false}', 'prev:{"skipFragments":false}']);
  });

  it("make Esc close what is open, one thing at a time, and leave when nothing is", () => {
    const onExit = vi.fn();
    const { press, chrome, state } = start({ onExit });
    chrome.hints(true);
    press(27);
    expect(host.querySelector(".ks-show-hints")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    press(49);
    expect(host.querySelector(".ks-show-jump:not([hidden])")).not.toBeNull();
    press(27);
    expect(host.querySelector(".ks-show-jump:not([hidden])")).toBeNull();
    state.overview = true;
    press(27);
    expect(state.overview).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    press(27);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("leave nothing on Esc when there is nowhere to go (the exported page)", () => {
    const { press } = start();
    expect(() => press(27)).not.toThrow();
  });

  it("make the slash a black screen and its Shift the list of keys", () => {
    const { press, calls } = start();
    press(191);
    expect(calls).toEqual(["pause"]);
    press(191, { shiftKey: true });
    expect(host.querySelector(".ks-show-hints")).not.toBeNull();
  });
});

describe("going to a slide by its number", () => {
  it("shows what is typed, and Enter goes to the slide", () => {
    const locate = vi.fn((n: number): [number, number] | null => (n === 12 ? [4, 1] : null));
    const { press, calls } = start({ locate });
    press(49);
    press(50);
    expect(host.querySelector(".ks-show-jump")?.textContent).toContain("12");
    press(13);
    expect(locate).toHaveBeenCalledWith(12);
    expect(calls).toEqual(["slide:4,1"]);
    expect(host.querySelector(".ks-show-jump:not([hidden])")).toBeNull();
  });

  it("takes the numpad's digits, and ignores a number there is no slide for", () => {
    const { press, calls } = start({ locate: () => null });
    press(103);
    press(13);
    expect(calls).toEqual([]);
  });

  it("forgets the number when it is not finished", () => {
    vi.useFakeTimers();
    const { press } = start();
    press(53);
    expect(host.querySelector(".ks-show-jump:not([hidden])")).not.toBeNull();
    vi.advanceTimersByTime(5000);
    expect(host.querySelector(".ks-show-jump:not([hidden])")).toBeNull();
  });

  it("keeps at most four digits", () => {
    const { press } = start();
    for (let i = 0; i < 7; i++) press(49);
    expect(host.querySelector(".ks-show-jump")?.textContent).toContain("1111");
    expect(host.querySelector(".ks-show-jump")?.textContent).not.toContain("11111");
  });

  it("closes the overview when it goes to a slide", () => {
    const { press, state } = start({ locate: () => [0, 0] });
    state.overview = true;
    press(49);
    press(13);
    expect(state.overview).toBe(false);
  });
});

describe("the laser pointer", () => {
  it("is a red dot at the pointer while it is on, and the stage says so", () => {
    const { press, chrome } = start();
    press(76);
    expect(stage.classList.contains("ks-show-laser-on")).toBe(true);
    const dot = host.querySelector<HTMLElement>(".ks-show-laser");
    expect(dot?.hidden).toBe(true);
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 30, clientY: 40 }));
    expect(dot?.hidden).toBe(false);
    expect(dot?.style.transform).toBe("translate(30px, 40px)");
    expect(chrome.laser(false)).toBe(false);
    expect(stage.classList.contains("ks-show-laser-on")).toBe(false);
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 1, clientY: 1 }));
    expect(dot?.style.transform).toBe("translate(30px, 40px)");
  });

  it("stops following the pointer when the tools are taken away", () => {
    const { press, chrome } = start();
    press(76);
    chrome.destroy();
    expect(stage.classList.contains("ks-show-laser-on")).toBe(false);
    expect(host.querySelector(".ks-show-laser")).toBeNull();
  });
});

describe("the list of keys", () => {
  it("lists the keys of the presentation, with S and Esc only where they do something", () => {
    const plain = start();
    plain.chrome.hints(true);
    const words = host.querySelector(".ks-show-hints")?.textContent ?? "";
    expect(words).toContain("Laser pointer");
    expect(words).not.toContain("Presenter view");
    expect(words).not.toContain("leave");
    plain.chrome.destroy();
    const full = start({ onPresenter: () => {}, onExit: () => {} });
    full.chrome.hints(true);
    expect(host.querySelector(".ks-show-hints")?.textContent).toContain("Presenter view");
    expect(host.querySelector(".ks-show-hints")?.textContent).toContain("leave");
  });

  it("opens and closes with the question mark, and by a click", () => {
    const { chrome } = start();
    expect(chrome.hints()).toBe(true);
    expect(chrome.hints()).toBe(false);
    chrome.hints(true);
    host.querySelector<HTMLElement>(".ks-show-hints")?.click();
    expect(host.querySelector(".ks-show-hints")).toBeNull();
  });

  it("shows a line of the main keys at the start, and takes it away by itself", () => {
    vi.useFakeTimers();
    start({ hintSeconds: 2 });
    const bar = host.querySelector(".ks-show-hintbar");
    expect(bar?.textContent).toContain("overview");
    expect(bar?.classList.contains("is-gone")).toBe(false);
    vi.advanceTimersByTime(2100);
    expect(bar?.classList.contains("is-gone")).toBe(true);
  });
});

describe("a picture shown large", () => {
  function picture(alt = "A blue box"): HTMLImageElement {
    const image = document.createElement("img");
    image.className = "ks-image-pic";
    image.alt = alt;
    image.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    return image;
  }

  it("opens when a picture is clicked, with what it says, and Esc puts it away", () => {
    const { slides, chrome } = start();
    const image = picture();
    slides.append(image);
    image.click();
    const box = host.querySelector(".ks-show-lightbox");
    expect(box?.querySelector("img")?.getAttribute("alt")).toBe("A blue box");
    expect(box?.textContent).toContain("A blue box");
    expect(chrome.lightboxOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    expect(chrome.lightboxOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(chrome.lightboxOpen()).toBe(false);
    expect(host.querySelector(".ks-show-lightbox")).toBeNull();
  });

  it("closes when it is clicked", () => {
    const { slides } = start();
    const image = picture();
    slides.append(image);
    image.click();
    host.querySelector<HTMLElement>(".ks-show-lightbox")?.click();
    expect(host.querySelector(".ks-show-lightbox")).toBeNull();
  });

  it("does not open for other things, or in the overview, or twice", () => {
    const { slides, state } = start();
    const other = document.createElement("div");
    slides.append(other);
    other.click();
    expect(host.querySelector(".ks-show-lightbox")).toBeNull();
    const image = picture();
    slides.append(image);
    state.overview = true;
    image.click();
    expect(host.querySelector(".ks-show-lightbox")).toBeNull();
    state.overview = false;
    image.click();
    image.click();
    expect(host.querySelectorAll(".ks-show-lightbox")).toHaveLength(1);
  });
});

describe("the arrows", () => {
  it("show while the pointer moves and go when it rests", () => {
    vi.useFakeTimers();
    start();
    expect(stage.classList.contains("is-active")).toBe(false);
    window.dispatchEvent(new MouseEvent("pointermove"));
    expect(stage.classList.contains("is-active")).toBe(true);
    vi.advanceTimersByTime(2600);
    expect(stage.classList.contains("is-active")).toBe(false);
  });
});
