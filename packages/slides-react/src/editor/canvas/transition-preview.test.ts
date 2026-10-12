import type { Element, Slide, Theme } from "@kasten-slides/wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playTransition } from "./transition-preview.ts";

const animate = vi.fn((..._args: unknown[]) => ({ cancel: () => {}, finished: Promise.resolve() }));

beforeEach(() => {
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true, writable: true });
  document.documentElement.dataset.motion = "on";
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  delete document.documentElement.dataset.motion;
});

const theme = { layouts: [{ name: "blank", label: "Blank", placeholders: [] }], master: [] } as unknown as Theme;

const box = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Element> = {}): Element => ({ type: "shape", id, shape: "rect", x, y, w, h, ...extra }) as Element;
const slide = (...elements: Element[]): Slide => ({ id: "s", layout: "blank", elements }) as unknown as Slide;

/** The page the slide is drawn on: a root with a node for each element, as the renderer makes them. */
function page(...ids: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const id of ids) {
    const node = document.createElement("div");
    node.dataset.el = id;
    root.append(node);
  }
  return root;
}

const frames = (call: number) => animate.mock.calls[call]![0] as Keyframe[];
const options = (call: number) => animate.mock.calls[call]![1] as KeyframeAnimationOptions;

describe("playing a transition on the canvas", () => {
  it("fades the slide in over the time asked for", () => {
    const root = page();
    const made = playTransition(root, "fade", 0.4, null, slide(), theme);
    expect(made).toHaveLength(1);
    expect(frames(0)).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(options(0).duration).toBe(400);
  });

  it("brings the slide in from the side for slide", () => {
    playTransition(page(), "slide", 0.5, null, slide(), theme);
    expect(frames(0)[0]).toMatchObject({ translate: "30% 0", opacity: 0 });
    expect(frames(0)[1]).toMatchObject({ translate: "0 0", opacity: 1 });
    expect(options(0).duration).toBe(500);
  });

  it("plays nothing for none, for no time, or while motion is off", () => {
    expect(playTransition(page(), "none", 0.4, null, slide(), theme)).toEqual([]);
    expect(playTransition(page(), "fade", 0, null, slide(), theme)).toEqual([]);
    document.documentElement.dataset.motion = "off";
    expect(playTransition(page(), "fade", 0.4, null, slide(), theme)).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not throw in a browser that cannot animate", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    expect(playTransition(page(), "fade", 0.4, null, slide(), theme)).toEqual([]);
  });

  it("moves the elements two slides share from the old box to the new one for morph, and fades in the rest", () => {
    const before = slide(box("a", 10, 10, 100, 50), box("gone", 0, 0, 10, 10));
    const after = slide(box("a", 210, 110, 200, 100), box("fresh", 300, 300, 50, 50));
    const root = page("a", "fresh");
    const made = playTransition(root, "morph", 0.6, before, after, theme);
    expect(made).toHaveLength(2);
    const byTarget = new Map(animate.mock.contexts.map((node, i) => [(node as HTMLElement).dataset.el, frames(i)]));
    expect(byTarget.get("a")?.[0]).toMatchObject({ translate: "-200px -100px", scale: "0.5 0.5", transformOrigin: "0 0" });
    expect(byTarget.get("a")?.[1]).toMatchObject({ translate: "0 0", scale: "1 1" });
    expect(byTarget.get("fresh")).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("pairs elements by their morph id, not only their id", () => {
    const before = slide(box("one", 0, 0, 100, 100, { morphId: "same" }));
    const after = slide(box("two", 100, 0, 100, 100, { morphId: "same" }));
    playTransition(page("two"), "morph", 0.6, before, after, theme);
    expect(frames(0)[0]).toMatchObject({ translate: "-100px 0px", scale: "1 1" });
  });

  it("is a fade when the slides have nothing in common, and leaves what has not moved alone", () => {
    playTransition(page("a"), "morph", 0.6, null, slide(box("a", 0, 0, 10, 10)), theme);
    expect(animate).toHaveBeenCalledTimes(2);
    animate.mockClear();
    const same = slide(box("a", 5, 5, 10, 10));
    playTransition(page("a"), "morph", 0.6, same, same, theme);
    // Shared and unmoved: nothing is animated for it, and as it is shared there is no fade of the whole slide either.
    expect(animate).not.toHaveBeenCalled();
  });
});
