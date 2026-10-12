// The canvas as a person meets it while a gesture goes on: the page is written to and the slide is not drawn again, and what was
// written is gone when the pointer is let go. Zooming and panning of the stage are here too.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { SlideCanvas } from "./SlideCanvas.tsx";

afterEach(cleanup);

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
});

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.setZoom(1);
  ui.toggleSnap();
  session.slides.add({ layout: "blank" });
  const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), shape("ellipse", { x: 500, y: 300, w: 120, h: 120 })]) as [string, string];
  session.select([]);
  const view = render(<SlideCanvas session={session} ui={ui} />);
  const page = () => view.container.querySelector<HTMLElement>(".ks-page")!;
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  const node = (id: string) => view.container.querySelector<HTMLElement>(`.ks-page-scale [data-el="${id}"]`)!;
  const frame = (id: string) => view.container.querySelector<HTMLElement>(`.ks-overlay [data-frame="${id}"]`)!;
  const handle = (name: string) => view.container.querySelector<HTMLElement>(`[data-handle="${name}"]`)!;
  const find = (id: string) => session.slide.elements.find((e) => e.id === id)!;
  return { session, ui, view, page, stage, node, frame, handle, find, a, b };
}

describe("a resize", () => {
  it("draws the element at the new box as the pointer goes, and the frame with it, and leaves nothing when it is let go", async () => {
    const { session, a, node, frame, handle, page, find } = await open();
    act(() => session.select([a]));
    const before = node(a);
    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(page(), { clientX: 360, clientY: 240 });
    // Drawn at 260 by 140 without the deck having changed.
    expect(find(a)).toMatchObject({ w: 200, h: 100 });
    expect([node(a).style.width, node(a).style.height]).toEqual(["260px", "140px"]);
    expect([frame(a).style.width, frame(a).style.height]).toEqual(["260px", "140px"]);
    // The same page node, not a new one.
    expect(node(a)).toBe(before);
    expect(view().querySelector(".ks-readout")?.textContent).toBe("260 × 140");
    fireEvent.pointerUp(page(), { clientX: 360, clientY: 240 });
    expect(find(a)).toMatchObject({ w: 260, h: 140 });
    expect([node(a).style.width, frame(a).style.width]).toEqual(["260px", "260px"]);
    expect(view().querySelector(".ks-readout")).toBeNull();
    act(() => session.undo());
    expect(node(a).style.width).toBe("200px");
    expect(frame(a).style.width).toBe("200px");

    function view() {
      return page().parentElement!.parentElement!;
    }
  });

  it("keeps the handle's cursor on the page while it is dragged, and gives back the page's own", async () => {
    const { session, a, handle, page } = await open();
    act(() => session.select([a]));
    expect(page().style.cursor).toBe("");
    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 300, clientY: 200 });
    expect(page().style.cursor).toBe("nwse-resize");
    fireEvent.pointerMove(page(), { clientX: 360, clientY: 240 });
    expect(page().style.cursor).toBe("nwse-resize");
    fireEvent.pointerUp(page(), { clientX: 360, clientY: 240 });
    expect(page().style.cursor).toBe("");
  });

  it("turns the cursors of the handles with the box, so a corner that points the other way says so", async () => {
    const { session, a, view } = await open();
    act(() => session.elements.transform([{ id: a, rotation: 90 }]));
    act(() => session.select([a]));
    const at = (name: string) => view.container.querySelector<HTMLElement>(`[data-handle="${name}"]`)!.style.cursor;
    // A quarter turn: what was the top left corner (nwse) is the top right (nesw), and the top edge is the right edge.
    expect(at("nw")).toBe("nesw-resize");
    expect(at("n")).toBe("ew-resize");
    expect(at("e")).toBe("ns-resize");
  });

  it("puts everything back on Escape", async () => {
    const { session, a, node, frame, handle, page, stage, find } = await open();
    act(() => session.select([a]));
    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(page(), { clientX: 360, clientY: 240 });
    expect(node(a).style.width).toBe("260px");
    fireEvent.keyDown(stage(), { key: "Escape" });
    expect([node(a).style.width, frame(a).style.width]).toEqual(["200px", "200px"]);
    fireEvent.pointerUp(page(), { clientX: 360, clientY: 240 });
    expect(find(a)).toMatchObject({ w: 200, h: 100 });
  });
});

describe("a turn", () => {
  it("rotates the element and its frame as the pointer goes, and says the angle", async () => {
    const { session, a, node, frame, page, find, view } = await open();
    act(() => session.select([a]));
    const rotate = view.container.querySelector<HTMLElement>("[data-rotate]")!;
    // The handle is above the top middle, at (200, 76): the pointer goes to the right of the middle, a quarter of a turn.
    fireEvent.pointerDown(rotate, { button: 0, clientX: 200, clientY: 76 });
    fireEvent.pointerMove(page(), { clientX: 300, clientY: 150 });
    const angle = node(a).style.getPropertyValue("rotate");
    expect(angle).toMatch(/^[0-9.]+deg$/);
    expect(frame(a).style.transform).toBe(`rotate(${parseFloat(angle)}deg)`);
    expect(view.container.querySelector(".ks-readout")?.textContent).toMatch(/°$/);
    expect(find(a).rotation ?? 0).toBe(0);
    fireEvent.pointerUp(page(), { clientX: 300, clientY: 150 });
    expect(find(a).rotation ?? 0).toBeGreaterThan(30);
    expect(node(a).style.getPropertyValue("rotate")).toBe("");
  });
});

describe("a move", () => {
  it("slides the element and the frame, and never draws the other element again", async () => {
    const { session, a, b, node, frame, page } = await open();
    act(() => session.select([a]));
    const other = node(b);
    fireEvent.pointerDown(page(), { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(page(), { clientX: 190, clientY: 170 });
    expect(node(a).style.translate).toBe("40px 20px");
    expect(frame(a).style.translate).toBe("40px 20px");
    expect(other.style.translate).toBe("");
    fireEvent.pointerUp(page(), { clientX: 190, clientY: 170 });
    expect(node(a).style.translate).toBe("");
    expect(frame(a).style.translate).toBe("");
    expect(node(b)).toBe(other);
  });

  it("copies with Alt: the stand-in goes with the pointer, the element stays, and a copy is made when it ends", async () => {
    const { session, a, node, page, view } = await open();
    act(() => session.select([a]));
    const count = session.slide.elements.length;
    fireEvent.pointerDown(page(), { button: 0, clientX: 150, clientY: 150, altKey: true });
    fireEvent.pointerMove(page(), { clientX: 250, clientY: 150, altKey: true });
    expect(node(a).style.translate).toBe("");
    expect(view.container.querySelector<HTMLElement>("[data-ghost]")!.style.translate).toBe("100px 0px");
    fireEvent.pointerUp(page(), { clientX: 250, clientY: 150, altKey: true });
    expect(view.container.querySelector("[data-ghost]")).toBeNull();
    expect(session.slide.elements).toHaveLength(count + 1);
  });
});

describe("coming to rest", () => {
  const calls: { node: Element; keyframes: Keyframe[] }[] = [];

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
    delete document.documentElement.dataset.motion;
    calls.length = 0;
  });

  const withMotion = () => {
    document.documentElement.dataset.motion = "on";
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      writable: true,
      value(this: Element, keyframes: Keyframe[]) {
        calls.push({ node: this, keyframes });
        return { cancel() {}, finished: Promise.resolve() };
      },
    });
  };
  const slides = () => calls.filter(({ node }) => node.hasAttribute("data-el"));

  it("glides an element back where it was when a move is undone, and does not for the drag that made it", async () => {
    const { session, a, node, page } = await open();
    act(() => session.select([a]));
    withMotion();
    fireEvent.pointerDown(page(), { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(page(), { clientX: 250, clientY: 150 });
    fireEvent.pointerUp(page(), { clientX: 250, clientY: 150 });
    // The drag showed the element going: nothing more is played for where it landed.
    expect(slides()).toHaveLength(0);
    act(() => session.undo());
    // It is where it was, and comes from where it had been: a hundred to the right.
    expect(slides()).toHaveLength(1);
    expect(slides()[0]!.node).toBe(node(a));
    expect(slides()[0]!.keyframes[0]).toMatchObject({ translate: "100px 0px" });
    expect(slides()[0]!.keyframes[1]).toMatchObject({ translate: "0 0" });
    act(() => session.redo());
    expect(slides()).toHaveLength(2);
    expect(slides()[1]!.keyframes[0]).toMatchObject({ translate: "-100px 0px" });
  });

  it("glides the elements an align moves, and not one moved a pixel by the arrow keys", async () => {
    const { session, a, b, stage } = await open();
    withMotion();
    act(() => session.select([a]));
    fireEvent.keyDown(stage(), { key: "ArrowRight" });
    expect(slides()).toHaveLength(0);
    act(() => session.elements.align("left", [a, b]));
    expect(slides().length).toBeGreaterThan(0);
  });

  it("lets the slide that was shown fade away over the one that takes its place, and takes the copy away after", async () => {
    const { session, view } = await open();
    const other = session.deck.slides[0]!.id;
    withMotion();
    let done = () => {};
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      writable: true,
      value(this: Element, keyframes: Keyframe[]) {
        calls.push({ node: this, keyframes });
        return { cancel() {}, finished: new Promise<void>((resolve) => (done = resolve)) };
      },
    });
    act(() => session.goTo(other));
    const copies = view.container.querySelectorAll("[data-leaving]");
    expect(copies).toHaveLength(1);
    expect(copies[0]!.getAttribute("aria-hidden")).toBe("true");
    // It has the slide that was shown, not the one that is.
    expect(copies[0]!.querySelector('[data-el]')).not.toBeNull();
    const fade = calls.find(({ node }) => node === copies[0]);
    expect(fade!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    done();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.container.querySelector("[data-leaving]")).toBeNull();
  });

  it("is still when the host's motion is off", async () => {
    const { session, a } = await open();
    act(() => session.select([a]));
    withMotion();
    document.documentElement.dataset.motion = "off";
    act(() => session.elements.nudge(100, 0));
    act(() => session.undo());
    expect(slides()).toHaveLength(0);
  });
});

describe("a zoom that glides", () => {
  const made: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; finished: boolean; cancelled: boolean }[] = [];
  let rects: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    document.documentElement.dataset.motion = "on";
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      writable: true,
      value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
        const record = { keyframes, options, finished: false, cancelled: false };
        made.push(record);
        return {
          playState: "running",
          finish() {
            record.finished = true;
          },
          cancel() {
            record.cancelled = true;
          },
          finished: new Promise(() => {}),
        };
      },
    });
    // jsdom has no layout: the page is as big as its style says, at a corner of the window.
    rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const page = this.classList.contains("ks-page");
      const w = page ? parseFloat((this as HTMLElement).style.width) || 0 : 0;
      const h = page ? parseFloat((this as HTMLElement).style.height) || 0 : 0;
      return { x: 40, y: 30, left: 40, top: 30, width: w, height: h, right: 40 + w, bottom: 30 + h, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    rects?.mockRestore();
    delete (Element.prototype as { animate?: unknown }).animate;
    delete document.documentElement.dataset.motion;
    made.length = 0;
  });

  it("is played on the page from its old size, over the host's slow step, for a zoom from the menu or the keys", async () => {
    const { ui } = await open();
    act(() => ui.setZoom(2));
    const pageGlides = made.filter((glide) => (glide.keyframes[0]?.transform as string | undefined)?.includes("scale("));
    expect(pageGlides).toHaveLength(1);
    expect(pageGlides[0]!.keyframes[0]!.transform).toContain("scale(0.5)");
    expect(pageGlides[0]!.keyframes[1]!.transform).toBe("translate(0px, 0px) scale(1)");
    expect(pageGlides[0]!.options.duration).toBe(200);
  });

  it("is not played for a wheel or a pinch, which are their own motion, or when the window changes what Fit comes to", async () => {
    const { ui } = await open();
    act(() => ui.zoomBy(1.3, { x: 100, y: 100 }));
    expect(made).toHaveLength(0);
    act(() => ui.setZoom("fit"));
    made.length = 0;
    act(() => ui.setFitZoom(0.8));
    expect(made).toHaveLength(0);
  });

  it("ends when the pointer is pressed, so that the press is on the slide where it is going", async () => {
    const { ui, page } = await open();
    act(() => ui.setZoom(2));
    const glide = made.find((one) => (one.keyframes[0]?.transform as string | undefined)?.includes("scale("))!;
    expect(glide.finished).toBe(false);
    fireEvent.pointerDown(page(), { button: 0, clientX: 500, clientY: 400 });
    expect(glide.finished).toBe(true);
  });
});

describe("zooming", () => {
  it("follows a Ctrl wheel continuously, about the pointer, and keeps the browser's own zoom away", async () => {
    const { ui, stage } = await open();
    const wheel = new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    act(() => void stage().dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    const once = ui.state.zoom as number;
    expect(once).toBeGreaterThan(1);
    // Not one of the menu's steps.
    expect([1.25, 1.5, 2]).not.toContain(once);
    act(() => void stage().dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: 100, clientX: 300, clientY: 200, bubbles: true, cancelable: true })));
    expect(ui.state.zoom as number).toBeCloseTo(1, 1);
  });

  it("leaves a plain wheel to the stage, which scrolls", async () => {
    const { ui, stage } = await open();
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => void stage().dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(false);
    expect(ui.state.zoom).toBe(1);
  });

  it("settles on Fit and on 100% when a wheel comes near them", async () => {
    const { ui, stage } = await open();
    act(() => ui.setFitZoom(1.01));
    act(() => void stage().dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -1, clientX: 0, clientY: 0, bubbles: true, cancelable: true })));
    // 1 and 1.01 are within 2% of each other; the zoom lands on Fit.
    expect(ui.state.zoom).toBe("fit");
  });
});

describe("two fingers", () => {
  const touch = (id: number, x: number, y: number) => ({ pointerType: "touch", pointerId: id, button: 0, clientX: x, clientY: y });

  it("take back what the first finger began, and zoom about the place between them as they move apart", async () => {
    const { session, ui, a, stage, page, find } = await open();
    act(() => session.select([a]));
    fireEvent.pointerDown(page(), touch(1, 150, 150));
    fireEvent.pointerMove(page(), touch(1, 190, 170));
    expect(page().querySelector<HTMLElement>(`[data-el="${a}"]`)!.style.translate).toBe("40px 20px");
    fireEvent.pointerDown(page(), touch(2, 250, 150));
    // The move the first finger had begun is called off.
    expect(page().querySelector<HTMLElement>(`[data-el="${a}"]`)!.style.translate).toBe("");
    // Fingers 60 apart go to 120 apart: twice as far, zoomed by about that.
    fireEvent.pointerMove(page(), touch(1, 130, 150));
    fireEvent.pointerMove(page(), touch(2, 250, 150));
    expect(ui.state.zoom as number).toBeGreaterThan(1);
    fireEvent.pointerUp(page(), touch(2, 250, 150));
    fireEvent.pointerUp(page(), touch(1, 130, 150));
    // Nothing moved on the slide, and the zoom is a plain number, not a step of the menu.
    expect(find(a)).toMatchObject({ x: 100, y: 100 });
    expect(stage().dataset.pan).toBeUndefined();
  });

  it("are not for the mouse", async () => {
    const { ui, page } = await open();
    fireEvent.pointerDown(page(), { pointerType: "mouse", pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(page(), { pointerType: "mouse", pointerId: 2, button: 0, clientX: 90, clientY: 10 });
    fireEvent.pointerMove(page(), { pointerType: "mouse", pointerId: 2, button: 0, clientX: 190, clientY: 10 });
    expect(ui.state.zoom).toBe(1);
  });
});

describe("panning", () => {
  it("moves the stage with the pointer while Space is held, and not the slide's elements", async () => {
    const { session, a, stage, page, find } = await open();
    act(() => session.select([]));
    stage().focus();
    fireEvent.keyDown(stage(), { key: " ", code: "Space" });
    expect(stage().dataset.pan).toBe("ready");
    stage().scrollLeft = 100;
    stage().scrollTop = 40;
    fireEvent.pointerDown(page(), { button: 0, clientX: 150, clientY: 150, pointerId: 3 });
    expect(stage().dataset.pan).toBe("drag");
    fireEvent.pointerMove(page(), { clientX: 120, clientY: 130, pointerId: 3 });
    // The stage follows the pointer: the pointer went 30 left and 20 up, so the page goes that way and the stage scrolls the other.
    expect([stage().scrollLeft, stage().scrollTop]).toEqual([130, 60]);
    fireEvent.pointerUp(page(), { clientX: 120, clientY: 130, pointerId: 3 });
    expect(stage().dataset.pan).toBe("ready");
    fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(stage().dataset.pan).toBeUndefined();
    expect(find(a)).toMatchObject({ x: 100, y: 100 });
    expect(session.state.selection).toEqual([]);
  });

  it("pans with the middle button without Space", async () => {
    const { stage, page } = await open();
    stage().scrollLeft = 50;
    fireEvent.pointerDown(page(), { button: 1, clientX: 100, clientY: 100, pointerId: 4 });
    fireEvent.pointerMove(page(), { clientX: 80, clientY: 100, pointerId: 4 });
    expect(stage().scrollLeft).toBe(70);
    fireEvent.pointerUp(page(), { button: 1, clientX: 80, clientY: 100, pointerId: 4 });
    expect(stage().dataset.pan).toBeUndefined();
  });
});
