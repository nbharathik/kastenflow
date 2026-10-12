// The live look of a drag, on a page made by hand: what is written to the elements and the frames while the pointer is down,
// and that everything is put back when it is up.

import type { Element } from "@kasten-slides/wasm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LiveBoxes } from "../../render/live.ts";
import type { Placement } from "../session/elements.ts";
import type { Preview } from "./controller.ts";
import { LiveLayer } from "./live.ts";
import { type Base, baseOf } from "./live-math.ts";

const NONE: Preview = { overrides: new Map(), guides: [], marquee: null, hits: [], drawing: null, angle: null, gesture: null, copy: false };
const preview = (overrides: [string, Placement][], gesture: Preview["gesture"], extra: Partial<Preview> = {}): Preview => ({ ...NONE, overrides: new Map(overrides), gesture, ...extra });

interface Piece {
  id: string;
  type: Element["type"];
  box: { x: number; y: number; w: number; h: number };
  rotation?: number;
}

let root: HTMLElement;
const pieces: Piece[] = [];
const bases = new Map<string, { base: Base; element: Element }>();

function build(list: Piece[]): { page: HTMLElement; layer: LiveLayer; boxes: LiveBoxes; zoom: { value: number }; follow: { map: Map<string, Placement> } } {
  pieces.splice(0, pieces.length, ...list);
  bases.clear();
  const page = document.createElement("div");
  page.className = "ks-page";
  const scale = document.createElement("div");
  scale.className = "ks-page-scale";
  const overlay = document.createElement("div");
  overlay.className = "ks-overlay";
  for (const piece of list) {
    const node = document.createElement("div");
    node.dataset.el = piece.id;
    node.style.left = `${piece.box.x}px`;
    scale.append(node);
    const frame = document.createElement("div");
    frame.dataset.frame = piece.id;
    frame.dataset.chrome = "";
    frame.style.left = `${piece.box.x}px`;
    frame.style.width = `${piece.box.w}px`;
    overlay.append(frame);
    const element = { id: piece.id, type: piece.type, rotation: piece.rotation ?? 0 } as unknown as Element;
    bases.set(piece.id, { base: baseOf(piece.box, element), element });
  }
  const chip = document.createElement("span");
  chip.className = "ks-move";
  chip.dataset.chrome = "";
  overlay.append(chip);
  const group = document.createElement("div");
  group.dataset.frame = "*";
  group.dataset.chrome = "";
  group.style.left = "10px";
  overlay.append(group);
  page.append(scale, overlay);
  root.append(page);
  const boxes = new LiveBoxes();
  const zoom = { value: 1 };
  const follow = { map: new Map<string, Placement>() };
  const layer = new LiveLayer({ page: () => page, zoom: () => zoom.value, find: (id) => bases.get(id) ?? null, followers: () => follow.map }, boxes);
  return { page, layer, boxes, zoom, follow };
}

const node = (page: HTMLElement, id: string): HTMLElement => page.querySelector<HTMLElement>(`[data-el="${id}"]`)!;
const frame = (page: HTMLElement, id: string): HTMLElement => page.querySelector<HTMLElement>(`[data-frame="${id}"]`)!;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => root.remove());

const A = { id: "a", type: "shape", box: { x: 100, y: 100, w: 200, h: 100 } } as const satisfies Piece;
const B = { id: "b", type: "shape", box: { x: 400, y: 300, w: 120, h: 120 } } as const satisfies Piece;

describe("a move", () => {
  it("slides each dragged element and the chrome by the same distance, in screen pixels for the chrome", () => {
    const { page, layer, zoom } = build([A, B]);
    zoom.value = 2;
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move"));
    expect(node(page, "a").style.translate).toBe("50px 30px");
    expect(node(page, "b").style.translate).toBe("");
    expect(frame(page, "a").style.translate).toBe("100px 60px");
    expect(page.querySelector<HTMLElement>(".ks-move")!.style.translate).toBe("100px 60px");
    expect(layer.active).toBe(true);
  });

  it("writes nothing again for a step that changes nothing, and follows a step that does", () => {
    const { page, layer } = build([A]);
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move"));
    const target = node(page, "a");
    const watcher = new MutationObserver(() => {});
    watcher.observe(target, { attributes: true });
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move"));
    expect(watcher.takeRecords()).toHaveLength(0);
    layer.apply(preview([["a", { x: 160, y: 130, w: 200, h: 100 }]], "move"));
    expect(target.style.translate).toBe("60px 30px");
    expect(watcher.takeRecords().length).toBeGreaterThan(0);
    watcher.disconnect();
  });

  it("puts everything back when the gesture is over, and leaves the frame's own style as it was", () => {
    const { page, layer, boxes } = build([A, B]);
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move"));
    layer.apply(NONE);
    expect(node(page, "a").style.translate).toBe("");
    expect(frame(page, "a").style.translate).toBe("");
    expect(frame(page, "a").style.left).toBe("100px");
    expect(layer.active).toBe(false);
    expect(boxes.get("a")).toBeUndefined();
  });

  it("puts back an element that the gesture no longer moves", () => {
    const { page, layer } = build([A, B]);
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }], ["b", { x: 410, y: 300, w: 120, h: 120 }]], "move"));
    expect(node(page, "b").style.translate).toBe("10px 0px");
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move"));
    expect(node(page, "b").style.translate).toBe("");
  });
});

describe("a move that copies", () => {
  it("leaves the element where it is and slides a stand-in, which is gone with the gesture", () => {
    const { page, layer } = build([A]);
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move", { copy: true }));
    const original = node(page, "a");
    expect(original.style.translate).toBe("");
    const ghost = page.querySelector<HTMLElement>("[data-ghost]")!;
    expect(ghost).not.toBeNull();
    expect(ghost.style.translate).toBe("50px 30px");
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.hasAttribute("data-el")).toBe(false);
    layer.apply(NONE);
    expect(page.querySelector("[data-ghost]")).toBeNull();
  });

  it("goes back to moving the element itself when the key is let go", () => {
    const { page, layer } = build([A]);
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move", { copy: true }));
    layer.apply(preview([["a", { x: 150, y: 130, w: 200, h: 100 }]], "move", { copy: false }));
    expect(page.querySelector("[data-ghost]")).toBeNull();
    expect(node(page, "a").style.translate).toBe("50px 30px");
  });
});

describe("a turn", () => {
  it("rotates the element about its middle, with the move of its middle, and turns the frame", () => {
    const { page, layer } = build([A]);
    layer.apply(preview([["a", { x: 100, y: 100, w: 200, h: 100, rotation: 30 }]], "rotate"));
    expect(node(page, "a").style.rotate).toBe("30deg");
    expect(node(page, "a").style.translate).toBe("0px 0px");
    expect(frame(page, "a").style.transform).toBe("rotate(30deg)");
    layer.apply(NONE);
    expect(node(page, "a").style.rotate).toBe("");
    expect(frame(page, "a").style.transform).toBe("");
  });
});

describe("a resize", () => {
  it("draws a few elements again at the new box, and the frame follows", () => {
    const { page, layer, boxes, zoom } = build([A]);
    zoom.value = 2;
    layer.apply(preview([["a", { x: 100, y: 100, w: 300, h: 100 }]], "resize"));
    expect(boxes.get("a")).toEqual({ x: 100, y: 100, w: 300, h: 100 });
    expect(node(page, "a").style.scale).toBe("");
    expect(frame(page, "a").style.left).toBe("200px");
    expect(frame(page, "a").style.width).toBe("600px");
    layer.apply(NONE);
    expect(boxes.get("a")).toBeUndefined();
    expect(frame(page, "a").style.width).toBe("200px");
  });

  it("stretches the elements when there are many, which costs no drawing", () => {
    const many: Piece[] = Array.from({ length: 14 }, (_, i) => ({ id: `e${i}`, type: "shape", box: { x: i * 10, y: 0, w: 10, h: 10 } }));
    const { page, layer, boxes } = build(many);
    layer.apply(preview(many.map((p): [string, Placement] => [p.id, { x: p.box.x * 2, y: 0, w: 20, h: 10 }]), "resize"));
    expect(boxes.get("e0")).toBeUndefined();
    expect(node(page, "e3").style.scale).toBe("2 1");
    // Its middle was at 35 and is at 70.
    expect(node(page, "e3").style.translate).toBe("35px 0px");
  });

  it("stretches a group about its middle, which is where the origin is put", () => {
    const { page, layer } = build([{ id: "g", type: "group", box: { x: 0, y: 0, w: 100, h: 100 } }]);
    layer.apply(preview([["g", { x: 0, y: 0, w: 200, h: 100 }]], "resize"));
    expect(node(page, "g").style.getPropertyValue("transform-origin")).toBe("50px 50px");
    expect(node(page, "g").style.scale).toBe("2 1");
  });

  it("sends the box round several to the group frame, and the connectors that follow to the boxes", () => {
    const { page, layer, boxes, follow } = build([A, B]);
    follow.map = new Map([["c", { x: 1, y: 2, w: 3, h: 4, flipH: true }]]);
    layer.apply(preview([["a", { x: 100, y: 100, w: 300, h: 100 }], ["b", { x: 400, y: 300, w: 120, h: 120 }]], "resize"));
    expect(frame(page, "*").style.left).toBe("100px");
    expect(frame(page, "*").style.width).toBe("420px");
    expect(boxes.get("c")).toEqual({ x: 1, y: 2, w: 3, h: 4, flipH: true });
  });
});

describe("a composite that is resized", () => {
  it("is a box for the whole slide to draw, not for the element", () => {
    const { layer, boxes } = build([{ id: "k", type: "code", box: { x: 0, y: 0, w: 100, h: 100 } }]);
    layer.apply(preview([["k", { x: 0, y: 0, w: 200, h: 100 }]], "resize"));
    expect(boxes.get("k")).toBeUndefined();
    expect(boxes.getWide().get("k")).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    layer.apply(NONE);
    expect(boxes.getWide().size).toBe(0);
  });
});
