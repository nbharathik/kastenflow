import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { type DocLike, type PageLike, PreviewController, type PreviewDeps } from "./controller";

type FakeDoc = DocLike & { destroy: Mock<() => void> };

/** A fake PDF of `n` pages (600 x 800 points unless told), the first byte naming it. */
function fakeDoc(n: number, height = 800): FakeDoc {
  const page: PageLike = { getViewport: ({ scale }) => ({ width: 600 * scale, height: height * scale }) };
  return { numPages: n, getPage: () => Promise.resolve(page), destroy: vi.fn<() => void>() };
}

function setup() {
  const docs = new Map<number, FakeDoc>();
  const gates: (() => void)[] = [];
  const state = { block: false, failPaint: false };
  const deps: PreviewDeps = {
    open: vi.fn((bytes: Uint8Array) => {
      const doc = docs.get(bytes[0]!);
      return doc ? Promise.resolve(doc) : Promise.reject(new Error("not a PDF"));
    }),
    paint: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          if (state.failPaint) return reject(new Error("out of memory"));
          if (state.block) gates.push(resolve);
          else resolve();
        }),
    ),
  };
  const el = document.createElement("div");
  let top = 0;
  Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => (top = v), configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 800 });
  Object.defineProperty(el, "clientWidth", { value: 624 });
  document.body.append(el);
  const events = { problem: vi.fn(), scaled: vi.fn() };
  const controller = new PreviewController(el, deps, events);
  return { controller, deps, docs, el, events, gates, state };
}

const bytes = (n: number) => new Uint8Array([n]);

describe("the preview controller", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("shows the first PDF fitted to the width and paints only the pages near the top", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(6));
    expect(await t.controller.load(bytes(1))).toBe(true);
    expect(t.el.querySelectorAll(".latex-page")).toHaveLength(6);
    // 800 pt pages in an 800 px window: the first and the one after it.
    expect(t.el.querySelectorAll("canvas")).toHaveLength(2);
    expect(t.events.problem).toHaveBeenLastCalledWith(null);
    expect(t.events.scaled).toHaveBeenLastCalledWith(1);
    expect(t.controller.shown).toBe(true);
  });

  it("keeps the reader at the same page and place after a rebuild, even when the pages changed size", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(10));
    t.docs.set(2, fakeDoc(10, 400));
    await t.controller.load(bytes(1));
    // Half way down page 5 (index 4).
    t.el.scrollTop = 12 + 4 * 812 + 400;
    expect(t.controller.anchor().page).toBe(4);
    await t.controller.load(bytes(2));
    expect(t.controller.anchor().page).toBe(4);
    expect(t.controller.anchor().ratio).toBeCloseTo(0.5, 1);
    expect(t.el.scrollTop).toBe(12 + 4 * 412 + 200);
    // The old PDF is released.
    expect(t.docs.get(1)!.destroy).toHaveBeenCalledTimes(1);
    expect(t.docs.get(2)!.destroy).not.toHaveBeenCalled();
  });

  it("keeps the zoom across rebuilds", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(4));
    t.docs.set(2, fakeDoc(4));
    await t.controller.load(bytes(1));
    await t.controller.setZoom(2);
    expect(t.controller.currentScale).toBe(2);
    expect(t.controller.currentZoom).toBe(2);
    await t.controller.load(bytes(2));
    expect(t.controller.currentScale).toBe(2);
    expect((t.el.querySelector(".latex-page") as HTMLElement).style.width).toBe("1200px");
  });

  it("zooming keeps the place and stays within limits", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(8));
    await t.controller.load(bytes(1));
    t.el.scrollTop = 12 + 3 * 812 + 200;
    await t.controller.zoomBy(1);
    expect(t.controller.currentScale).toBeCloseTo(1.25);
    expect(t.controller.anchor().page).toBe(3);
    expect(t.controller.anchor().ratio).toBeCloseTo(0.25, 1);
    for (let i = 0; i < 12; i++) await t.controller.zoomBy(1);
    expect(t.controller.currentScale).toBe(4);
    for (let i = 0; i < 20; i++) await t.controller.zoomBy(-1);
    expect(t.controller.currentScale).toBe(0.25);
    await t.controller.setZoom("fit");
    expect(t.controller.currentScale).toBe(1);
  });

  it("keeps the last good PDF, and says why, when the new one cannot be opened", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(3));
    await t.controller.load(bytes(1));
    const column = t.el.firstElementChild;
    expect(await t.controller.load(bytes(9))).toBe(false);
    expect(t.el.firstElementChild).toBe(column);
    expect(t.docs.get(1)!.destroy).not.toHaveBeenCalled();
    expect(t.events.problem).toHaveBeenLastCalledWith("The new PDF could not be opened: not a PDF");
    // A good one afterwards clears the message.
    t.docs.set(2, fakeDoc(3));
    expect(await t.controller.load(bytes(2))).toBe(true);
    expect(t.events.problem).toHaveBeenLastCalledWith(null);
  });

  it("keeps the last good PDF when the new one cannot be drawn, and lets the new one go", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(3));
    t.docs.set(2, fakeDoc(3));
    await t.controller.load(bytes(1));
    const column = t.el.firstElementChild;
    t.state.failPaint = true;
    expect(await t.controller.load(bytes(2))).toBe(false);
    expect(t.el.firstElementChild).toBe(column);
    expect(t.docs.get(2)!.destroy).toHaveBeenCalledTimes(1);
    expect(t.docs.get(1)!.destroy).not.toHaveBeenCalled();
    expect(t.events.problem).toHaveBeenLastCalledWith("The new PDF could not be drawn: out of memory");
  });

  it("swaps only when the new pages are painted: the old ones stay on screen meanwhile", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(3));
    t.docs.set(2, fakeDoc(3));
    await t.controller.load(bytes(1));
    const old = t.el.firstElementChild;
    t.state.block = true;
    const loading = t.controller.load(bytes(2));
    await vi.waitFor(() => expect(t.gates.length).toBeGreaterThan(0));
    expect(t.el.firstElementChild).toBe(old);
    t.state.block = false;
    t.gates.splice(0).forEach((go) => go());
    expect(await loading).toBe(true);
    expect(t.el.firstElementChild).not.toBe(old);
    expect(t.el.children).toHaveLength(1);
  });

  it("when two builds finish close together, the newer one wins and the older is let go without a complaint", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(3));
    t.docs.set(2, fakeDoc(3));
    t.state.block = true;
    const first = t.controller.load(bytes(1));
    const second = t.controller.load(bytes(2));
    await vi.waitFor(() => expect(t.gates.length).toBeGreaterThan(0));
    t.state.block = false;
    t.gates.splice(0).forEach((go) => go());
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(t.docs.get(1)!.destroy).toHaveBeenCalled();
    expect(t.events.problem).not.toHaveBeenCalledWith(expect.stringContaining("could not"));
  });

  it("a resize while a new PDF is being drawn does not throw that PDF away", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(3));
    t.docs.set(2, fakeDoc(3));
    await t.controller.load(bytes(1));
    t.state.block = true;
    const loading = t.controller.load(bytes(2));
    await vi.waitFor(() => expect(t.gates.length).toBeGreaterThan(0));
    await t.controller.relayout();
    t.state.block = false;
    t.gates.splice(0).forEach((go) => go());
    expect(await loading).toBe(true);
    expect(t.docs.get(2)!.destroy).not.toHaveBeenCalled();
    expect(t.docs.get(1)!.destroy).toHaveBeenCalled();
  });

  it("paints pages as the reader gets to them", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(8));
    await t.controller.load(bytes(1));
    expect(t.el.querySelectorAll("canvas")).toHaveLength(2);
    t.el.scrollTop = 12 + 6 * 812;
    await t.controller.paintVisible();
    // Pages 5, 6 and 7 joined the first two.
    expect(t.el.querySelectorAll("canvas")).toHaveLength(5);
    const again = (t.deps.paint as ReturnType<typeof vi.fn>).mock.calls.length;
    await t.controller.paintVisible();
    expect((t.deps.paint as ReturnType<typeof vi.fn>).mock.calls.length).toBe(again);
  });

  it("scrolls to a place SyncTeX found and marks it for a moment", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.docs.set(1, fakeDoc(5));
    await t.controller.load(bytes(1));
    await t.controller.showHit({ page: 3, x: 72, y: 300, width: 200, height: 10, depth: 3 });
    // Page 3 starts at 12 + 2 * 812; the line is 290 points down; a third of the window is left above it.
    expect(t.el.scrollTop).toBe(12 + 2 * 812 + 290 - Math.round(800 / 3));
    const flash = t.el.querySelector(".latex-sync-flash") as HTMLElement;
    expect(flash).not.toBeNull();
    expect(flash.style.top).toBe("290px");
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.el.querySelector(".latex-sync-flash")).toBeNull();
  });

  it("a place on a page that is not there does nothing", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(2));
    await t.controller.load(bytes(1));
    await t.controller.showHit({ page: 9, x: 0, y: 0, width: 1, height: 1, depth: 0 });
    expect(t.el.querySelector(".latex-sync-flash")).toBeNull();
  });

  it("dispose lets the PDF go", async () => {
    const t = setup();
    t.docs.set(1, fakeDoc(2));
    await t.controller.load(bytes(1));
    t.controller.dispose();
    expect(t.docs.get(1)!.destroy).toHaveBeenCalledTimes(1);
  });
});

beforeEach(() => {
  document.body.replaceChildren();
});
