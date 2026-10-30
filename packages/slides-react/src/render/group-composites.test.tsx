// @vitest-environment node

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

// Formulas draw once the math module has loaded; load it up front, as the exports do.
import "./math.ts";
import { SlideView } from "./SlideView.tsx";
import { box, scene } from "./testing/decks.ts";
import { draw, elementsOf } from "./testing/dom.ts";

vi.mock("../text/TextBlock.tsx", () => import("./testing/mock-text-block.tsx"));

describe("a composite inside a group", () => {
  it("is drawn as the parts it expands to, as it is on the slide itself", async () => {
    const group = {
      type: "group",
      id: "g",
      children: [
        { type: "shape", id: "s", shape: "rect", ...box(0, 0, 50, 50) },
        { type: "code", id: "c", language: "python", code: "print(1)", ...box(60, 0, 300, 120) },
      ],
    } as unknown as Element;
    const { deck, slide } = await scene("blank", [group]);
    const parts = elementsOf(draw(<SlideView deck={deck} slide={slide} mode="present" />));
    expect(parts.has("s")).toBe(true);
    // Not the grey box a composite the drawing cannot expand becomes.
    expect(parts.get("c")?.querySelector(".ks-raw")).toBeNull();
    expect([...parts.keys()].some((id) => id.startsWith("c."))).toBe(true);
  });

  it("keeps a group with no composite in it as it was", async () => {
    const group = { type: "group", id: "g", children: [{ type: "shape", id: "s", shape: "rect", ...box(0, 0, 50, 50) }] } as unknown as Element;
    const { deck, slide } = await scene("blank", [group]);
    const parts = elementsOf(draw(<SlideView deck={deck} slide={slide} mode="present" />));
    expect([...parts.keys()].filter((id) => !id.startsWith("master")).sort()).toEqual(["g", "s"]);
  });

  it("draws a formula in a group as a formula", async () => {
    const group = { type: "group", id: "g", children: [{ type: "math", id: "m", latex: "x^2", ...box(0, 0, 200, 80) }] } as unknown as Element;
    const { deck, slide } = await scene("blank", [group]);
    const parts = elementsOf(draw(<SlideView deck={deck} slide={slide} mode="present" />));
    expect(parts.get("m")?.querySelector(".katex")).not.toBeNull();
  });
});
