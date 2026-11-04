// @vitest-environment node

import type { Element, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { fxPlanOf, hasFx, roleOf, stateAt } from "./fx-plan.ts";

const theme = plainDeck([]).deck.theme;
const box = (id: string, extra: Record<string, unknown> = {}): Element => ({ type: "shape", shape: "rect", id, x: 0, y: 0, w: 10, h: 10, ...extra }) as unknown as Element;
const slide = (...elements: Element[]): Slide => ({ id: "s", layout: "blank", steps: 3, elements });

describe("what an element looks like at a step", () => {
  it("is the entry with the greatest step that is not after it, else normal", () => {
    const e = box("a", { stepStates: { 1: "hidden", 3: "dimmed" } });
    expect([0, 1, 2, 3, 4].map((n) => stateAt(e, n))).toEqual(["normal", "hidden", "hidden", "dimmed", "dimmed"]);
  });

  it("makes a change an entrance when the element appears, an exit when it goes, else a way to draw the eye", () => {
    expect(roleOf("hidden", "normal")).toBe("enter");
    expect(roleOf("normal", "hidden")).toBe("exit");
    expect(roleOf("normal", "highlighted")).toBe("emph");
    expect(roleOf("hidden", "hidden")).toBe("emph");
  });
});

describe("the plan of a slide's effects", () => {
  it("lists by step the elements that name an effect, in the slide's order, with their role", () => {
    const plan = fxPlanOf(
      slide(
        box("a", { stepStates: { 0: "hidden", 1: "normal", 2: "hidden" }, stepFx: { 1: { kind: "fly", direction: "left" }, 2: { kind: "fade" } } }),
        box("b", { stepFx: { 1: { kind: "pulse", duration: 0.2 }, 3: { kind: "colour", color: "accent2" } } }),
        box("c"),
      ),
      theme,
    );
    expect(plan[1]?.map((p) => [p.id, p.role, p.fx.kind])).toEqual([
      ["a", "enter", "fly"],
      ["b", "emph", "pulse"],
    ]);
    expect(plan[2]?.map((p) => [p.id, p.role])).toEqual([["a", "exit"]]);
    expect(plan[3]?.[0]?.fx.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(hasFx(plan)).toBe(true);
  });

  it("is empty for a slide that names none, and leaves out step 0", () => {
    expect(hasFx(fxPlanOf(slide(box("a")), theme))).toBe(false);
    expect(hasFx(fxPlanOf(slide(box("a", { stepFx: { 0: { kind: "fade" } } })), theme))).toBe(false);
  });
});
