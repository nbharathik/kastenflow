// Boxes a drag draws elements in: only the view of an element that was taken somewhere is drawn again, the slide is not.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveBoxes, LiveContext, placedElement } from "./live.ts";
import { SlideView } from "./SlideView.tsx";
import { box, scene } from "./testing/decks.ts";

vi.mock("../text/TextBlock.tsx", () => import("./testing/mock-text-block.tsx"));

afterEach(cleanup);

const rect = (id: string, x: number, y: number): Element => ({ type: "shape", id, shape: "rect", ...box(x, y, 100, 50) }) as Element;

describe("the boxes a drag has taken elements to", () => {
  it("tells only the element that moved, and not for a box that is the same again", () => {
    const live = new LiveBoxes();
    const a = vi.fn();
    const b = vi.fn();
    live.watch("a").subscribe(a);
    live.watch("b").subscribe(b);
    live.set(new Map([["a", { x: 1, y: 2, w: 3, h: 4 }]]));
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 0]);
    live.set(new Map([["a", { x: 1, y: 2, w: 3, h: 4 }]]));
    expect(a).toHaveBeenCalledTimes(1);
    live.set(new Map([["a", { x: 1, y: 2, w: 3, h: 4 }], ["b", { x: 0, y: 0, w: 1, h: 1 }]]));
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    // What is no longer named goes back to the slide's own box, and is told.
    live.set(new Map());
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 2]);
    expect(live.get("a")).toBeUndefined();
  });

  it("answers the same object for a box that did not change, so a view does not draw again", () => {
    const live = new LiveBoxes();
    live.set(new Map([["a", { x: 1, y: 2, w: 3, h: 4 }]]));
    const first = live.get("a");
    live.set(new Map([["a", { x: 1, y: 2, w: 3, h: 4 }]]));
    expect(live.get("a")).toBe(first);
  });

  it("keeps the boxes the whole slide is drawn for apart, and forgets everything on clear", () => {
    const live = new LiveBoxes();
    const told = vi.fn();
    live.subscribeWide(told);
    live.setWide(new Map([["k", { x: 0, y: 0, w: 5, h: 5 }]]));
    live.setWide(new Map([["k", { x: 0, y: 0, w: 5, h: 5 }]]));
    expect(told).toHaveBeenCalledTimes(1);
    live.set(new Map([["a", { x: 1, y: 2, w: 3, h: 4 }]]));
    live.clear();
    expect(live.get("a")).toBeUndefined();
    expect(live.getWide().size).toBe(0);
    expect(told).toHaveBeenCalledTimes(2);
  });

  it("puts a box on an element, only the fields it has", () => {
    const element = { type: "shape", id: "a", shape: "rect", x: 1, y: 1, w: 1, h: 1, rotation: 20 } as Element;
    expect(placedElement(element, undefined)).toBe(element);
    expect(placedElement(element, { x: 5, y: 6, w: 7, h: 8 })).toMatchObject({ x: 5, y: 6, w: 7, h: 8, rotation: 20 });
    expect(placedElement(element, { x: 5, y: 6, w: 7, h: 8, rotation: 45, flipH: true })).toMatchObject({ rotation: 45, flipH: true });
  });
});

describe("the slide drawn with live boxes", () => {
  it("draws an element at the box it was taken to, and nothing else again", async () => {
    const { deck, slide } = await scene("blank", [rect("a", 10, 20), rect("b", 300, 200)]);
    const live = new LiveBoxes();
    const view = render(
      <LiveContext.Provider value={live}>
        <SlideView deck={deck} slide={slide} mode="edit" />
      </LiveContext.Provider>,
    );
    const nodeOf = (id: string) => view.container.querySelector<HTMLElement>(`[data-el="${id}"]`)!;
    const a = nodeOf("a");
    const b = nodeOf("b");
    expect(a.style.left).toBe("10px");
    act(() => live.set(new Map([["a", { x: 40, y: 60, w: 160, h: 90 }]])));
    expect(nodeOf("a")).toBe(a);
    expect([a.style.left, a.style.top, a.style.width, a.style.height]).toEqual(["40px", "60px", "160px", "90px"]);
    expect(b.style.left).toBe("300px");
    // A turn the drag gives is drawn, and it goes when the drag does.
    act(() => live.set(new Map([["a", { x: 40, y: 60, w: 160, h: 90, rotation: 30 }]])));
    expect(a.style.transform).toContain("rotate(30deg)");
    act(() => live.clear());
    expect([a.style.left, a.style.width]).toEqual(["10px", "100px"]);
    expect(a.style.transform).toBe("");
  });

  it("is drawn as before where there is no store: in a presentation, a thumbnail or an export", async () => {
    const { deck, slide } = await scene("blank", [rect("a", 10, 20)]);
    const view = render(<SlideView deck={deck} slide={slide} mode="thumbnail" />);
    expect(view.container.querySelector<HTMLElement>('[data-el="a"]')!.style.left).toBe("10px");
  });
});
