// @vitest-environment node

import type { Element, Text } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import { SlideView } from "./SlideView.tsx";
import { blocks, draw, elementsOf, styleOf } from "./testing/dom.ts";
import { box, scene, words } from "./testing/decks.ts";

vi.mock("../text/TextBlock.tsx", () => import("./testing/mock-text-block.tsx"));

/** Draws one element on a blank slide and returns the page. */
async function page(element: Element, mode: "edit" | "present" = "present") {
  const { deck, slide } = await scene("blank", [element]);
  return draw(<SlideView deck={deck} slide={slide} mode={mode} />);
}

const shape = (extra: Partial<Element> = {}): Element => ({ type: "shape", id: "e", shape: "rect", ...box(100, 50, 200, 80), ...extra }) as Element;

describe("the box of an element", () => {
  it("is placed by its own x, y, w and h, with the element's id and type where an editor can find it", async () => {
    const el = elementsOf(await page(shape())).get("e");
    expect(el?.className).toBe("ks-el");
    expect(el?.getAttribute("data-type")).toBe("shape");
    expect(styleOf(el)).toEqual({ position: "absolute", left: "100px", top: "50px", width: "200px", height: "80px" });
  });

  it("is turned about its centre by its rotation", async () => {
    const style = styleOf(elementsOf(await page(shape({ rotation: 30 }))).get("e"));
    expect(style.transform).toBe("rotate(30deg) scale(1, 1)");
    expect(style["transform-origin"]).toBe("center");
  });

  it("is mirrored by its flips, and the turn is done after the flip", async () => {
    const at = async (extra: Partial<Element>) => styleOf(elementsOf(await page(shape(extra))).get("e")).transform;
    expect(await at({ flipH: true })).toBe("rotate(0deg) scale(-1, 1)");
    expect(await at({ flipV: true })).toBe("rotate(0deg) scale(1, -1)");
    expect(await at({ flipH: true, flipV: true, rotation: -45 })).toBe("rotate(-45deg) scale(-1, -1)");
  });

  it("has no transform when it is upright", async () => {
    const style = styleOf(elementsOf(await page(shape({ rotation: 0 }))).get("e"));
    expect(style.transform).toBeUndefined();
    expect(style["transform-origin"]).toBeUndefined();
  });

  it("is as opaque as its style says", async () => {
    expect(styleOf(elementsOf(await page(shape({ style: { opacity: 0.4 } }))).get("e")).opacity).toBe("0.4");
    expect(styleOf(elementsOf(await page(shape({ style: { opacity: 1 } }))).get("e")).opacity).toBeUndefined();
  });

  it("names the slot it fills", async () => {
    const { deck, slide } = await scene("title-only", [{ type: "text", id: "t", placeholder: "title", text: words("Hello") }]);
    const el = elementsOf(draw(<SlideView deck={deck} slide={slide} />)).get("t");
    expect(el?.getAttribute("data-placeholder")).toBe("title");
  });

  it("takes the box it does not name from the slot it fills", async () => {
    const { deck, slide } = await scene("title-only", [
      { type: "text", id: "t", placeholder: "title", text: words("Hello") },
      { type: "text", id: "u", placeholder: "title", h: 40, text: words("Hello") },
    ]);
    const found = elementsOf(draw(<SlideView deck={deck} slide={slide} />));
    expect(styleOf(found.get("t"))).toEqual({ position: "absolute", left: "64px", top: "36px", width: "832px", height: "96px" });
    expect(styleOf(found.get("u"))).toMatchObject({ left: "64px", top: "36px", width: "832px", height: "40px" });
  });

  it("is not drawn when nothing gives it a box", async () => {
    const { deck, slide } = await scene("blank", [{ type: "shape", id: "e", shape: "rect", ...box(0, 0, 10, 10) }]);
    const lost: typeof slide = { ...slide, elements: [{ type: "shape", id: "lost", shape: "rect" } as Element, ...slide.elements] };
    // (A new deck shows no slide number, so the master draws nothing here.)
    expect([...elementsOf(draw(<SlideView deck={deck} slide={lost} />)).keys()]).toEqual(["e"]);
  });

  it("says what it is to assistive technology, when it has no words of its own", async () => {
    const drawn = elementsOf(await page(shape({ alt: "A blue box" }))).get("e");
    expect(drawn?.getAttribute("role")).toBe("img");
    expect(drawn?.getAttribute("aria-label")).toBe("A blue box");
    const boxed = elementsOf(await page({ type: "text", id: "e", ...box(0, 0, 50, 20), alt: "Ignored", text: words("Hi") })).get("e");
    expect(boxed?.hasAttribute("role")).toBe(false);
  });
});

describe("text", () => {
  it("is drawn by the text module in the element's whole box, in the body style", async () => {
    const [block] = blocks(await page({ type: "text", id: "e", ...box(10, 20, 300, 90), text: words("Plain") }));
    expect(block).toMatchObject({ el: "e", words: "Plain", baseStyle: "body", width: 300, height: 90, valign: "top" });
    expect(block?.insets).toEqual({ left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 });
  });

  it("starts from the style of the slot it fills, and sits where the slot puts it", async () => {
    const { deck, slide } = await scene("title", [
      { type: "text", id: "t", placeholder: "title", text: words("Big") },
      { type: "text", id: "s", placeholder: "subtitle", text: words("Small") },
    ]);
    const found = blocks(draw(<SlideView deck={deck} slide={slide} />));
    expect(found.find((b) => b.el === "t")).toMatchObject({ baseStyle: "display", valign: "bottom", width: 832, height: 148 });
    expect(found.find((b) => b.el === "s")).toMatchObject({ baseStyle: "subtitle", valign: "top" });
  });

  it("prefers the alignment and insets the text names to the defaults", async () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "x" }] }], valign: "bottom", insets: { left: 1, top: 2, right: 3, bottom: 4 } };
    const { deck, slide } = await scene("title-only", [{ type: "text", id: "t", placeholder: "title", text }]);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} />))[0]).toMatchObject({ valign: "bottom", insets: { left: 1, top: 2, right: 3, bottom: 4 } });
  });

  it("paints its box when its style has a fill or an outline", async () => {
    const styled: Element = { type: "text", id: "e", ...box(0, 0, 200, 60), text: words("Hi"), style: { fill: { color: "bg2" }, stroke: { color: "accent1", width: 2 }, radius: 10 } };
    const found = elementsOf(await page(styled)).get("e");
    const path = found?.querySelector("svg.ks-shape path");
    expect(path?.getAttribute("fill")).toBe("#f1f3f4");
    expect(path?.getAttribute("stroke")).toBe("#1a73e8");
    expect(path?.getAttribute("d")).toContain("A10 10 0 0 1");
    expect(found?.querySelector("svg.ks-shape")?.nextElementSibling?.className).toBe("ks-fill");
  });

  it("paints nothing when it has no style", async () => {
    const found = elementsOf(await page({ type: "text", id: "e", ...box(0, 0, 200, 60), text: words("Hi") })).get("e");
    expect(found?.querySelector("svg")).toBeNull();
  });

  it("stays the right way up when the element is flipped", async () => {
    const found = elementsOf(await page({ type: "text", id: "e", ...box(0, 0, 200, 60), flipH: true, text: words("Hi") })).get("e");
    expect(styleOf(found).transform).toBe("rotate(0deg) scale(-1, 1)");
    expect(styleOf(found?.querySelector(".ks-fill")).transform).toBe("scale(-1, 1)");
  });
});
