// @vitest-environment node

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import type { SlideMode } from "./context.ts";
import { SlideView } from "./SlideView.tsx";
import { blocks, draw, elementsOf, styleOf } from "./testing/dom.ts";
import { box, scene, withStates, words } from "./testing/decks.ts";

vi.mock("../text/TextBlock.tsx", () => import("./testing/mock-text-block.tsx"));

const MODES: SlideMode[] = ["edit", "present", "thumbnail", "export"];

describe("an empty placeholder", () => {
  async function empty(mode: SlideMode) {
    const { deck, slide, slots } = await scene("title-body", [], { keepSlots: true });
    const page = draw(<SlideView deck={deck} slide={slide} mode={mode} />);
    return { page, title: slots.title ?? "", body: slots.body ?? "" };
  }

  it("asks an editor for what it needs, through the text module", async () => {
    const { page, title, body } = await empty("edit");
    const found = blocks(page);
    expect(found.find((b) => b.el === title)?.emptyPrompt).toBe("Click to add title");
    expect(found.find((b) => b.el === body)?.emptyPrompt).toBe("Click to add text");
  });

  it("is not there for an audience", async () => {
    for (const mode of ["present", "thumbnail", "export"] as const) {
      const { page, title, body } = await empty(mode);
      const found = elementsOf(page);
      expect(found.has(title), mode).toBe(false);
      expect(found.has(body), mode).toBe(false);
      expect(blocks(page), mode).toEqual([]);
    }
  });

  it("is drawn once it has words, with no prompt in any mode", async () => {
    for (const mode of MODES) {
      const { deck, slide } = await scene("title-only", [{ type: "text", id: "t", placeholder: "title", text: words("Hello") }]);
      const [block] = blocks(draw(<SlideView deck={deck} slide={slide} mode={mode} />));
      expect(block, mode).toMatchObject({ el: "t", words: "Hello" });
      expect(block?.emptyPrompt, mode).toBeUndefined();
    }
  });

  it("counts a placeholder of spaces as empty", async () => {
    const { deck, slide } = await scene("title-only", [{ type: "text", id: "t", placeholder: "title", text: words("   ") }]);
    expect(elementsOf(draw(<SlideView deck={deck} slide={slide} mode="present" />)).has("t")).toBe(false);
  });

  it("does not leave out a text box that fills no placeholder", async () => {
    const { deck, slide } = await scene("blank", [{ type: "text", id: "t", ...box(0, 0, 100, 40), text: words("") }]);
    for (const mode of MODES) {
      expect(elementsOf(draw(<SlideView deck={deck} slide={slide} mode={mode} />)).has("t"), mode).toBe(true);
    }
  });

  it("shows an editor, and only an editor, that an empty text box of its own is there", async () => {
    const { deck, slide } = await scene("blank", [{ type: "text", id: "t", ...box(0, 0, 100, 40), text: words("") }]);
    const edit = draw(<SlideView deck={deck} slide={slide} mode="edit" />);
    expect(blocks(edit)[0]?.emptyPrompt).toBe("Click to add text");
    expect(edit.querySelector("[data-el=t] .ks-empty-box")).not.toBeNull();
    for (const mode of ["present", "thumbnail", "export"] as const) {
      const page = draw(<SlideView deck={deck} slide={slide} mode={mode} />);
      expect(blocks(page)[0]?.emptyPrompt, mode).toBeUndefined();
      expect(page.querySelector(".ks-empty-box"), mode).toBeNull();
    }
  });

  it("shows no prompt or outline once the box has words", async () => {
    const { deck, slide } = await scene("blank", [{ type: "text", id: "t", ...box(0, 0, 100, 40), text: words("Hi") }]);
    const edit = draw(<SlideView deck={deck} slide={slide} mode="edit" />);
    expect(blocks(edit)[0]?.emptyPrompt).toBeUndefined();
    expect(edit.querySelector(".ks-empty-box")).toBeNull();
  });

  it("does not count a field as empty", async () => {
    const text = { paragraphs: [{ runs: [{ t: "", field: "slideNumber" }] }] };
    const { deck, slide } = await scene("title-only", [{ type: "text", id: "t", placeholder: "title", text }]);
    expect(elementsOf(draw(<SlideView deck={deck} slide={slide} mode="present" />)).has("t")).toBe(true);
  });
});

describe("hideTextOf", () => {
  const two: Element[] = [
    { type: "text", id: "a", ...box(0, 0, 100, 40), text: words("first"), style: { fill: { color: "bg2" } } },
    { type: "shape", id: "b", shape: "rect", ...box(0, 50, 100, 40), text: words("second") },
    { type: "connector", id: "c", route: "straight", ...box(0, 100, 100, 40), label: words("third") },
  ];

  it("leaves the text of that element out, and keeps it drawn otherwise", async () => {
    const { deck, slide } = await scene("blank", two);
    const page = draw(<SlideView deck={deck} slide={slide} hideTextOf="a" mode="edit" />);
    expect(blocks(page).map((b) => b.el)).toEqual(["b", "c"]);
    const a = elementsOf(page).get("a");
    expect(a).toBeDefined();
    expect(a?.querySelector("svg path")?.getAttribute("fill")).toBe("#f1f3f4");
  });

  it("works for the text of a shape and a connector label", async () => {
    const { deck, slide } = await scene("blank", two);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} hideTextOf="b" />)).map((b) => b.el)).toEqual(["a", "c"]);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} hideTextOf="c" />)).map((b) => b.el)).toEqual(["a", "b"]);
  });

  it("works for the text of an element in a group", async () => {
    const group: Element = { type: "group", id: "g", children: two.slice(0, 2) } as Element;
    const { deck, slide } = await scene("blank", [group]);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} hideTextOf="b" />)).map((b) => b.el)).toEqual(["a"]);
  });

  it("draws everything when it is null or names nothing", async () => {
    const { deck, slide } = await scene("blank", two);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} hideTextOf={null} />))).toHaveLength(3);
    expect(blocks(draw(<SlideView deck={deck} slide={slide} hideTextOf="nope" />))).toHaveLength(3);
  });
});

describe("steps", () => {
  type States = NonNullable<Element["stepStates"]>;
  const shape = (extra: Partial<Element> = {}): Element => ({ type: "shape", id: "e", shape: "rect", ...box(100, 100, 200, 100), text: words("x"), ...extra }) as Element;

  async function at(states: States, step: number | undefined, mode: SlideMode = "present", element = shape()) {
    const { deck, slide } = await scene("blank", [element]);
    const page = draw(<SlideView deck={deck} slide={withStates(slide, { [element.id]: states })} step={step} mode={mode} />);
    return { page, el: elementsOf(page).get(element.id), deck, slide };
  }

  it("shows everything as it is styled when no step is given", async () => {
    const { el } = await at({ 0: "hidden" }, undefined);
    expect(el).toBeDefined();
    expect(styleOf(el).opacity).toBeUndefined();
    expect(el?.querySelector(".ks-highlight")).toBeNull();
  });

  it("does not draw an element a step hides, in any mode but an editor", async () => {
    for (const mode of ["present", "thumbnail", "export"] as const) {
      const { el, page } = await at({ 0: "hidden", 2: "normal" }, 1, mode);
      expect(el, mode).toBeUndefined();
      expect(blocks(page), mode).toEqual([]);
    }
  });

  it("brings the element back at the step that says so", async () => {
    const states: States = { 0: "hidden", 2: "normal" };
    expect((await at(states, 2)).el).toBeDefined();
    expect((await at(states, 5)).el).toBeDefined();
    expect((await at(states, 0)).el).toBeUndefined();
  });

  it("holds a state until the next change", async () => {
    const states: States = { 1: "hidden", 4: "dimmed" };
    expect((await at(states, 0)).el).toBeDefined();
    expect((await at(states, 3)).el).toBeUndefined();
    expect(styleOf((await at(states, 4)).el).opacity).toBe("0.25");
    expect(styleOf((await at(states, 9)).el).opacity).toBe("0.25");
  });

  it("outlines a hidden element in an editor, at 30% opacity, and draws nothing of it", async () => {
    const { el, page } = await at({ 0: "hidden" }, 1, "edit");
    expect(el?.className).toBe("ks-el ks-ghost");
    expect(el?.getAttribute("data-type")).toBe("shape");
    expect(styleOf(el)).toMatchObject({ left: "100px", top: "100px", width: "200px", height: "100px", opacity: "0.3" });
    expect(styleOf(el?.querySelector(".ks-ghost-box"))["border-color"]).toBe("#5f6368");
    expect(el?.querySelector("svg")).toBeNull();
    expect(blocks(page)).toEqual([]);
  });

  it("dims an element to the theme's dimmed opacity, times its own", async () => {
    expect(styleOf((await at({ 0: "dimmed" }, 0)).el).opacity).toBe("0.25");
    expect(styleOf((await at({ 0: "dimmed" }, 0, "present", shape({ style: { opacity: 0.8 } }))).el).opacity).toBe("0.2");
    const { deck, slide } = await at({ 0: "dimmed" }, 0);
    const faint = { ...deck, theme: { ...deck.theme, dimmedOpacity: 0.5 } };
    expect(styleOf(elementsOf(draw(<SlideView deck={faint} slide={withStates(slide, { e: { 0: "dimmed" } })} step={0} />)).get("e")).opacity).toBe("0.5");
  });

  it("outlines a highlighted element in the theme's highlight colour and width", async () => {
    const { el, deck, slide } = await at({ 0: "highlighted" }, 0);
    expect(styleOf(el?.querySelector(":scope > .ks-highlight")).outline).toBe("2px solid #1a73e8");
    expect(styleOf(el).opacity).toBeUndefined();
    const custom = { ...deck, theme: { ...deck.theme, highlight: { color: "#ff0000", width: 5 } } };
    const page = draw(<SlideView deck={custom} slide={withStates(slide, { e: { 0: "highlighted" } })} step={0} />);
    expect(styleOf(elementsOf(page).get("e")?.querySelector(".ks-highlight")).outline).toBe("5px solid #ff0000");
  });

  it("stands the highlight off the element and rounds it where the element is round", async () => {
    const ring = async (element: Element) => styleOf((await at({ 0: "highlighted" }, 0, "present", element)).el?.querySelector(":scope > .ks-highlight"));
    expect(await ring(shape())).toMatchObject({ "outline-offset": "2px" });
    expect((await ring(shape()))["border-radius"]).toBeUndefined();
    expect((await ring(shape({ shape: "roundRect", style: { radius: 16 } })))["border-radius"]).toBe("16px");
    expect((await ring(shape({ shape: "ellipse" })))["border-radius"]).toBe("50%");
    const picture = { type: "image", id: "e", src: "a.png", ...box(0, 0, 100, 100), mask: "roundRect" } as Element;
    expect((await ring(picture))["border-radius"]).toBe("12px");
  });

  it("gives the text module the step, for paragraphs that build", async () => {
    expect(blocks((await at({}, 3)).page)[0]?.step).toBe(3);
    expect(blocks((await at({}, undefined)).page)[0]?.step).toBeUndefined();
  });

  it("hides what a group hides, and dims and highlights the group as a whole", async () => {
    const group: Element = {
      type: "group",
      id: "g",
      children: [
        { type: "shape", id: "a", shape: "rect", ...box(100, 100, 50, 50) },
        { type: "shape", id: "b", shape: "rect", ...box(200, 150, 100, 50) },
      ],
    } as Element;
    const drawn = async (states: States, mode: SlideMode = "present") => (await at(states, 0, mode, group)).page;
    const ids = (page: Document) => [...elementsOf(page).keys()].filter((id) => id !== "master-number");
    expect(ids(await drawn({ 0: "hidden" }))).toEqual([]);
    const ghosts = elementsOf(await drawn({ 0: "hidden" }, "edit"));
    expect(ghosts.get("g")?.className).toBe("ks-group");
    expect(ghosts.get("a")?.className).toBe("ks-el ks-ghost");
    expect(ghosts.get("b")?.className).toBe("ks-el ks-ghost");
    expect(styleOf(ghosts.get("g")).opacity).toBeUndefined();
    expect(styleOf(elementsOf(await drawn({ 0: "dimmed" })).get("g")).opacity).toBe("0.25");
    const lit = elementsOf(await drawn({ 0: "highlighted" })).get("g")?.querySelector(":scope > .ks-highlight");
    expect(styleOf(lit)).toMatchObject({ left: "100px", top: "100px", width: "200px", height: "100px", outline: "2px solid #1a73e8" });
  });
});
