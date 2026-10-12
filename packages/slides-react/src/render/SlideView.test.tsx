// @vitest-environment node

import type { DeckEngine, Element } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import { SlideView } from "./SlideView.tsx";
import { blocks, draw, elementsOf, styleOf } from "./testing/dom.ts";
import { box, scene, words } from "./testing/decks.ts";

vi.mock("../text/TextBlock.tsx", () => import("./testing/mock-text-block.tsx"));

const ids = (root: ParentNode) => [...root.querySelectorAll("[data-el]")].map((node) => node.getAttribute("data-el"));

/** A new deck shows no slide numbers: a scene that draws the master's number asks for it. */
const numbered = { edit: (engine: DeckEngine) => void engine.apply("set_present", { slideNumbers: true }) };

describe("SlideView", () => {
  it("is a box of the deck's size, in the theme's background", async () => {
    const { deck, slide } = await scene("blank");
    const root = draw(<SlideView deck={deck} slide={slide} />).querySelector(".ks-slide");
    expect(styleOf(root)).toMatchObject({ width: "960px", height: "540px", position: "relative", overflow: "hidden", background: "#ffffff" });
    expect(root?.getAttribute("data-slide")).toBe(slide.id);
    expect(root?.getAttribute("data-mode")).toBe("present");
  });

  it("follows the theme: colours, and the body font", async () => {
    const { deck, slide } = await scene("blank", [], { theme: "Dark" });
    const root = draw(<SlideView deck={deck} slide={slide} />).querySelector(".ks-slide");
    expect(styleOf(root)).toMatchObject({ background: "#0f1115", color: "#f1f3f4" });
    expect(styleOf(root)["font-family"]).toBe('"Inter", "Helvetica Neue", "Arial", sans-serif');
  });

  it("is the size of a four by three deck", async () => {
    const { deck, slide } = await scene("blank");
    const root = draw(<SlideView deck={{ ...deck, size: { w: 720, h: 540 } }} slide={slide} />).querySelector(".ks-slide");
    expect(styleOf(root)).toMatchObject({ width: "720px", height: "540px" });
  });

  it("takes a class and a style from its caller", async () => {
    const { deck, slide } = await scene("blank");
    const root = draw(<SlideView deck={deck} slide={slide} className="mine" style={{ transform: "scale(0.2)", transformOrigin: "0 0" }} />).querySelector(".ks-slide");
    expect(root?.className).toBe("ks-slide mine");
    expect(styleOf(root)).toMatchObject({ transform: "scale(0.2)", "transform-origin": "0 0", width: "960px" });
  });

  it("paints the slide's own background colour, as a token or a hex value", async () => {
    const withColor = (color: string) => scene("blank", [], { edit: (engine, id) => engine.apply("set_background", { slide: id, background: { color } }) });
    const token = await withColor("accent2");
    expect(styleOf(draw(<SlideView deck={token.deck} slide={token.slide} />).querySelector(".ks-slide")).background).toBe("#ea4335");
    const hex = await withColor("#123456");
    expect(styleOf(draw(<SlideView deck={hex.deck} slide={hex.slide} />).querySelector(".ks-slide")).background).toBe("#123456");
  });

  it("draws a background image over the colour, through imageUrl", async () => {
    const { deck, slide } = await scene("blank", [], { edit: (engine, id) => engine.apply("set_background", { slide: id, background: { image: "assets/sky.png" } }) });
    const page = draw(<SlideView deck={deck} slide={slide} imageUrl={(src) => `blob:${src}`} />);
    const image = page.querySelector<HTMLImageElement>("img.ks-bg");
    expect(image?.getAttribute("src")).toBe("blob:assets/sky.png");
    expect(image?.getAttribute("alt")).toBe("");
    expect(styleOf(page.querySelector(".ks-slide")).background).toBe("#ffffff");
    expect(page.querySelector(".ks-slide")?.firstElementChild).toBe(image);
  });

  it("uses the stored path as the address of an image when it is given no imageUrl", async () => {
    const { deck, slide } = await scene("blank", [], { edit: (engine, id) => engine.apply("set_background", { slide: id, background: { image: "assets/sky.png" } }) });
    expect(draw(<SlideView deck={deck} slide={slide} />).querySelector("img.ks-bg")?.getAttribute("src")).toBe("assets/sky.png");
  });

  it("draws the theme's master under the slide's elements, bottom to top", async () => {
    const { deck, slide } = await scene("title-only", [{ type: "shape", id: "low", shape: "rect", ...box(0, 0, 10, 10) }, { type: "shape", id: "high", shape: "rect", ...box(5, 5, 10, 10) }], {
      theme: "Lecture",
      ...numbered,
    });
    const page = draw(<SlideView deck={deck} slide={slide} />);
    // The theme's empty logo draws nothing; the bar and the number are there.
    expect(ids(page)).toEqual(["master-bar", "master-number", "low", "high"]);
    const found = elementsOf(page);
    expect(found.get("master-bar")?.getAttribute("data-master")).toBe("true");
    expect(found.get("low")?.hasAttribute("data-master")).toBe(false);
  });

  it("leaves the master out on a layout that hides it", async () => {
    const { deck, slide } = await scene("title", [{ type: "shape", id: "only", shape: "rect", ...box(0, 0, 10, 10) }], { theme: "Lecture", ...numbered });
    expect(ids(draw(<SlideView deck={deck} slide={slide} />))).toEqual(["only"]);
  });

  it("draws the master of a theme that has only the slide number", async () => {
    const { deck, slide } = await scene("blank", [], numbered);
    expect(ids(draw(<SlideView deck={deck} slide={slide} />))).toEqual(["master-number"]);
  });

  it("gives the slide-number field its number, the count and the step label", async () => {
    const { deck, slide: plain } = await scene("blank", [], numbered);
    const slide = { ...plain, steps: 7 };
    const at = (props: object) => blocks(draw(<SlideView deck={deck} slide={slide} {...props} />), true)[0];
    expect(at({ number: 3, count: 12, step: 2 })?.fields).toEqual({ slideNumber: 3, slideCount: 12, stepLabel: "Step 2 / 7" });
    expect(at({ number: 3, count: 12 })?.fields).toEqual({ slideNumber: 3, slideCount: 12 });
    expect(at({})?.fields).toEqual({});
  });

  it("has no step label on a slide without steps", async () => {
    const { deck, slide } = await scene("blank", [], numbered);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} step={1} />), true)[0]?.fields).toEqual({});
  });

  it("words the step label as the deck says", async () => {
    const { deck, slide } = await scene("blank", [], numbered);
    const custom = { ...deck, present: { ...deck.present, stepLabel: "{n} of {total} ({n})" } };
    expect(blocks(draw(<SlideView deck={custom} slide={{ ...slide, steps: 4 }} step={3} />), true)[0]?.fields?.stepLabel).toBe("3 of 4 (3)");
  });

  it("hides the slide numbers the deck turns off, in an editor too", async () => {
    const { deck, slide } = await scene("blank");
    const off = { ...deck, present: { ...deck.present, slideNumbers: false } };
    for (const mode of ["present", "thumbnail", "export", "edit"] as const) {
      expect(ids(draw(<SlideView deck={off} slide={slide} mode={mode} />)), mode).toEqual([]);
    }
  });

  it("draws the slide number the deck turns on, in every mode", async () => {
    const { deck, slide } = await scene("blank");
    const on = { ...deck, present: { ...deck.present, slideNumbers: true } };
    for (const mode of ["present", "thumbnail", "export", "edit"] as const) {
      expect(ids(draw(<SlideView deck={on} slide={slide} mode={mode} />)), mode).toEqual(["master-number"]);
    }
  });

  it("shows no number on a title slide either when the deck turns them off", async () => {
    const { deck, slide } = await scene("title");
    const off = { ...deck, present: { ...deck.present, slideNumbers: false } };
    expect(ids(draw(<SlideView deck={off} slide={{ ...slide, elements: [] }} mode="edit" />))).toEqual([]);
    const on = { ...deck, present: { ...deck.present, slideNumbers: true } };
    expect(ids(draw(<SlideView deck={on} slide={{ ...slide, elements: [] }} mode="edit" />))).toEqual(["master-number"]);
  });

  it("keeps the slide numbers of the slide's own elements whatever the deck says", async () => {
    const own: Element = { type: "text", id: "mine", ...box(0, 0, 50, 20), text: { paragraphs: [{ runs: [{ t: "‹#›", field: "slideNumber" }] }] } };
    const { deck, slide } = await scene("blank", [own]);
    const off = { ...deck, present: { ...deck.present, slideNumbers: false } };
    expect(ids(draw(<SlideView deck={off} slide={slide} />))).toEqual(["mine"]);
  });

  it("draws a slide of a layout the theme lacks, with what has a box of its own", async () => {
    const { deck, slide } = await scene("blank", [{ type: "text", id: "kept", ...box(1, 2, 3, 4), text: words("Hi") }]);
    const page = draw(<SlideView deck={deck} slide={{ ...slide, layout: "gone" }} />);
    expect(ids(page)).toContain("kept");
  });
});
