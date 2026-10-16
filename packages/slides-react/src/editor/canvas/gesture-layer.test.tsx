import type { Guide } from "@kasten-slides/canvas";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo, type Preview } from "./controller.ts";
import { GestureLayer, sameView, viewOf } from "./GestureLayer.tsx";
import { GuideBoard, MOST_GAPS, MOST_LINES, keyedGuides, limitGuides } from "./guides-dom.ts";
import { readoutOf } from "./Readout.tsx";

afterEach(cleanup);

const line = (at: number, kind: Guide["kind"] = "edge", axis: Guide["axis"] = "x", from = 0, to = 100): Guide => ({ axis, at, from, to, kind });

describe("which guide is which", () => {
  it("tells a line by where it is, so one that stays is the same from step to step even as it grows", () => {
    const a = keyedGuides([line(100, "edge", "x", 0, 50)]);
    const b = keyedGuides([line(100, "edge", "x", 0, 200)]);
    expect([...a.keys()]).toEqual([...b.keys()]);
    expect([...keyedGuides([line(100, "centre")]).keys()]).not.toEqual([...a.keys()]);
  });

  it("tells gap marks apart by where they are, and keeps two on the same line apart", () => {
    const keys = [...keyedGuides([line(40, "spacing", "y", 10, 30), line(40, "spacing", "y", 60, 80), line(100, "edge"), line(100, "edge")]).keys()];
    expect(new Set(keys).size).toBe(4);
  });
});

describe("how many guides are worth drawing", () => {
  it("draws every line up to a limit, and the gap marks nearest what is moved", () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i * 10));
    const gaps = Array.from({ length: 9 }, (_, i) => line(50, "spacing", "y", i * 100, i * 100 + 40));
    const shown = limitGuides([...lines, ...gaps], { x: 410, y: 50 });
    expect(shown.filter((g) => g.kind !== "spacing")).toHaveLength(MOST_LINES);
    const marks = shown.filter((g) => g.kind === "spacing");
    expect(marks).toHaveLength(MOST_GAPS);
    // Those nearest x = 410 are the marks that start at 400, 300, 500 and 200.
    expect(marks.map((g) => g.from).sort((a, b) => a - b)).toContain(400);
    expect(marks.map((g) => g.from)).not.toContain(0);
  });

  it("draws what there is when there is little", () => {
    expect(limitGuides([line(10), line(20, "spacing", "y")], null)).toHaveLength(2);
    expect(limitGuides([], null)).toEqual([]);
  });
});

describe("the guides in the page", () => {
  const host = () => {
    const node = document.createElement("div");
    document.body.append(node);
    return node;
  };
  /** The guides that are shown: a guide put away is hidden, and stays in the page for the next one. */
  const nodes = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>(".ks-guide-set")].filter((set) => set.style.visibility === "visible").map((set) => set.querySelector<HTMLElement>(".ks-guide")!);
  const all = (node: HTMLElement) => node.querySelectorAll(".ks-guide-set").length;

  it("puts a line at the slide's corner and stretches it along its length, in screen pixels, with nothing that needs layout", () => {
    const node = host();
    const board = new GuideBoard(node);
    board.show([line(100, "edge", "x", 20, 220), line(50, "spacing", "y", 10, 34)], 2);
    const [vertical, gap] = nodes(node);
    expect([vertical!.style.translate, vertical!.style.scale]).toEqual(["200px 40px", "1 400"]);
    expect(vertical!.className).toBe("ks-guide is-edge");
    // Across a gap: the line, a tick at each end, and the size of the gap in the middle.
    expect([gap!.style.translate, gap!.style.scale]).toEqual(["20px 100px", "48 1"]);
    const set = gap!.parentElement!;
    const ticks = [...set.querySelectorAll<HTMLElement>(".ks-guide-tick")];
    expect(ticks.map((tick) => tick.style.translate)).toEqual(["20px 96px", "68px 96px"]);
    expect(set.querySelector(".ks-guide-label")!.textContent).toBe("24");
    expect((set.querySelector(".ks-guide-label") as HTMLElement).style.translate).toBe("44px 100px");
    for (const part of [vertical!, gap!, ...ticks]) expect(part.style.left + part.style.top + part.style.width + part.style.height).toBe("");
    board.dispose();
    node.remove();
  });

  it("keeps the node of a line that stays, and stretches it when the line grows, and writes nothing for a step that changes nothing", () => {
    const node = host();
    const board = new GuideBoard(node);
    board.show([line(100, "edge", "x", 0, 50)], 1);
    const [first] = nodes(node);
    const watcher = new MutationObserver(() => {});
    watcher.observe(first!, { attributes: true });
    board.show([line(100, "edge", "x", 0, 50)], 1);
    expect(watcher.takeRecords()).toHaveLength(0);
    board.show([line(100, "edge", "x", 0, 80)], 1);
    expect(nodes(node)[0]).toBe(first);
    expect(first!.style.scale).toBe("1 80");
    watcher.disconnect();
    board.dispose();
    node.remove();
  });

  describe("fading", () => {
    const played: { node: Element; keyframes: Keyframe[]; finish: () => void }[] = [];
    beforeEach(() => {
      document.documentElement.dataset.motion = "on";
      Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        writable: true,
        value(this: Element, keyframes: Keyframe[]) {
          let finish = () => {};
          const finished = new Promise<void>((resolve) => (finish = resolve));
          played.push({ node: this, keyframes, finish });
          return { cancel() {}, finished };
        },
      });
    });
    afterEach(() => {
      delete (Element.prototype as { animate?: unknown }).animate;
      delete document.documentElement.dataset.motion;
      played.length = 0;
    });

    it("lets a line that goes fade, and puts it away when it is done", async () => {
      const node = host();
      const board = new GuideBoard(node);
      board.show([line(100)], 1);
      // It came in with a fade.
      expect(played.at(-1)!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      board.show([], 1);
      expect(played.at(-1)!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
      // Faded, not yet gone.
      expect(nodes(node)).toHaveLength(1);
      played.at(-1)!.finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(nodes(node)).toHaveLength(0);
      board.dispose();
      node.remove();
    });

    it("lets a flurry come and go without fading, but fades them all when everything goes at the end", async () => {
      const node = host();
      const board = new GuideBoard(node);
      board.show(Array.from({ length: 6 }, (_, i) => line(i * 10)), 1);
      played.length = 0;
      // Four of six going while two stay: churn.
      board.show([line(0), line(10)], 1);
      expect(played).toHaveLength(0);
      expect(nodes(node)).toHaveLength(2);
      // The last two going with nothing coming: the end.
      board.show([], 1);
      expect(played).toHaveLength(2);
      board.dispose();
      expect(all(node)).toBe(0);
      node.remove();
    });
  });

  it("uses a node again for the next guide, so that a step that has guides come and go makes no nodes", async () => {
    const node = host();
    const board = new GuideBoard(node);
    document.documentElement.dataset.motion = "off";
    try {
      board.show([line(100), line(200)], 1);
      const made = all(node);
      for (let i = 0; i < 20; i += 1) board.show(i % 2 ? [line(100 + i), line(200 + i)] : [line(300 + i)], 1);
      expect(all(node)).toBe(made);
      // A gap mark is another kind of node, kept apart from the lines.
      board.show([line(50, "spacing", "y", 0, 20)], 1);
      const withGap = all(node);
      board.show([], 1);
      board.show([line(60, "spacing", "y", 0, 20)], 1);
      expect(all(node)).toBe(withGap);
      // It says what it is now: the class and the axis follow the guide.
      board.show([line(5, "centre", "y", 0, 90)], 1);
      const [shown] = nodes(node);
      expect([shown!.className, shown!.dataset.axis]).toEqual(["ks-guide is-centre", "y"]);
    } finally {
      delete document.documentElement.dataset.motion;
    }
    board.dispose();
    node.remove();
  });

  it("puts guides back where they go when the zoom changes", () => {
    const node = host();
    const board = new GuideBoard(node);
    board.show([line(100, "edge", "x", 0, 50)], 1);
    board.show([line(100, "edge", "x", 0, 50)], 2);
    expect(nodes(node)[0]!.style.translate).toBe("200px 0px");
    board.dispose();
    node.remove();
  });
});

describe("when the layer is drawn again", () => {
  const step = (x: number, extra: Partial<Preview> = {}): Preview => ({
    overrides: new Map([["a", { x, y: 0, w: 10, h: 10 }]]),
    guides: [],
    marquee: null,
    hits: [],
    drawing: null,
    angle: null,
    gesture: "move",
    copy: false,
    ...extra,
  });

  it("is not for the steps of a plain move, nor for the guides, which are written to the page", () => {
    expect(sameView(viewOf(step(1)), viewOf(step(2)))).toBe(true);
    expect(sameView(viewOf(step(1)), viewOf(step(1, { guides: [line(5), line(40, "spacing", "y", 10, 30)] })))).toBe(true);
  });

  it("is not for the steps of a resize or a turn either: the number beside them is written to the page", () => {
    expect(sameView(viewOf(step(1, { gesture: "resize" })), viewOf(step(2, { gesture: "resize" })))).toBe(true);
    expect(sameView(viewOf(step(1, { gesture: "rotate", angle: 10 })), viewOf(step(1, { gesture: "rotate", angle: 20 })))).toBe(true);
  });

  it("is for the rectangle, and for a gesture that begins", () => {
    expect(sameView(viewOf(step(1, { gesture: "move" })), viewOf(step(1, { gesture: "resize" })))).toBe(false);
    const rect = { x: 0, y: 0, w: 5, h: 5 };
    expect(sameView(viewOf(step(1, { marquee: rect })), viewOf(step(1, { marquee: { ...rect, w: 6 } })))).toBe(false);
    expect(sameView(viewOf(step(1, { marquee: rect })), viewOf(step(1, { marquee: { ...rect } })))).toBe(true);
  });
});

describe("what a gesture says in numbers", () => {
  const only = new Map([["a", { x: 100, y: 100, w: 200, h: 100 }]]);

  it("is the size beside what is resized, and the box round several", () => {
    expect(readoutOf({ gesture: "resize", angle: null, overrides: only })).toMatchObject({ text: "200 × 100" });
    const two = new Map([...only, ["b", { x: 400, y: 100, w: 100, h: 100 }]]);
    expect(readoutOf({ gesture: "resize", angle: null, overrides: two })).toMatchObject({ text: "400 × 100" });
  });

  it("is the angle beside what is turned", () => {
    expect(readoutOf({ gesture: "rotate", angle: 44.6, overrides: only })).toMatchObject({ text: "45°" });
    expect(readoutOf({ gesture: "rotate", angle: null, overrides: only })).toBeNull();
  });

  it("is the place of the box beside what is moved, and of the box round several", () => {
    expect(readoutOf({ gesture: "move", angle: null, overrides: only })).toMatchObject({ text: "100, 100" });
    expect(readoutOf({ gesture: "grab", angle: null, overrides: new Map([["a", { x: 12.4, y: 99.6, w: 10, h: 10 }]]) })).toMatchObject({ text: "12, 100" });
    const two = new Map([...only, ["b", { x: 40, y: 150, w: 100, h: 100 }]]);
    expect(readoutOf({ gesture: "move", angle: null, overrides: two })).toMatchObject({ text: "40, 100" });
  });

  it("is nothing for a selection, a drawing or nothing", () => {
    expect(readoutOf({ gesture: "marquee", angle: null, overrides: only })).toBeNull();
    expect(readoutOf({ gesture: "draw", angle: null, overrides: only })).toBeNull();
    expect(readoutOf({ gesture: null, angle: null, overrides: new Map() })).toBeNull();
    expect(readoutOf({ gesture: "resize", angle: null, overrides: new Map() })).toBeNull();
    expect(readoutOf({ gesture: "move", angle: null, overrides: new Map() })).toBeNull();
  });
});

describe("the gesture layer", () => {
  const at = (x: number, y: number): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1 });

  async function open() {
    const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
    const ui = new EditorUi();
    const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), shape("rect", { x: 500, y: 100, w: 200, h: 100 })]) as [string, string];
    session.select([]);
    const controller = new CanvasController(session, ui, () => 1);
    const view = render(<GestureLayer session={session} controller={controller} zoom={1} />);
    return { session, controller, view, a, b };
  }

  it("draws the selection rectangle while it is dragged, with what it would take outlined, and nothing after", async () => {
    const { controller, view } = await open();
    controller.down(at(50, 50), { kind: "surface" });
    act(() => controller.move(at(320, 220)));
    expect(view.container.querySelector(".ks-marquee")).not.toBeNull();
    expect(view.container.querySelectorAll(".ks-outline.is-hit")).toHaveLength(1);
    act(() => controller.up(at(320, 220)));
    expect(view.container.querySelector(".ks-marquee")).toBeNull();
    expect(view.container.querySelectorAll(".ks-outline.is-hit")).toHaveLength(0);
  });

  it("draws the guide a box snaps to, as a line at the place", async () => {
    const { controller, view, a } = await open();
    controller.down(at(150, 150), { kind: "surface" });
    // The left edge of the box would be 5 short of the other box's: it lands on it, and the guide is drawn there.
    act(() => controller.move(at(150 + 405, 150)));
    expect(controller.preview.overrides.get(a)?.x).toBe(500);
    const guide = view.container.querySelector<HTMLElement>(".ks-guide")!;
    expect(guide).not.toBeNull();
    expect(guide.style.translate.startsWith("500px ")).toBe(true);
    act(() => controller.cancel());
  });

  it("says where a box is beside it while it is moved, and nothing after", async () => {
    const { controller, view, a } = await open();
    // The place the box is drawn at, which a guide may have pulled a little from where the pointer took it.
    const where = () => {
      const box = controller.preview.overrides.get(a)!;
      return `${Math.round(box.x)}, ${Math.round(box.y)}`;
    };
    controller.down(at(150, 150), { kind: "surface" });
    act(() => controller.move(at(190, 170)));
    expect(view.container.querySelector(".ks-readout")?.textContent).toBe(where());
    act(() => controller.move(at(200, 180)));
    expect(view.container.querySelectorAll(".ks-readout")).toHaveLength(1);
    expect(view.container.querySelector(".ks-readout")?.textContent).toBe(where());
    act(() => controller.up(at(200, 180)));
    expect(view.container.querySelector(".ks-readout")).toBeNull();
  });

  it("says the size beside a box being resized", async () => {
    const { session, controller, view, a } = await open();
    session.select([a]);
    controller.down(at(300, 200), { kind: "handle", handle: "se" });
    act(() => controller.move(at(400, 260)));
    expect(view.container.querySelector(".ks-readout")?.textContent).toBe("300 × 160");
    act(() => controller.cancel());
    expect(view.container.querySelector(".ks-readout")).toBeNull();
  });
});
