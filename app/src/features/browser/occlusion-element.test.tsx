import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { covered, occludeElement, useOccludesElement, useOcclusion } from "./occlusion";

const AREA = { left: 200, top: 100, right: 800, bottom: 600 };

/** Gives elements the rectangles a test says (jsdom lays nothing out). */
function layout(rects: Map<Element, { left: number; top: number; right: number; bottom: number }>) {
  const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const r = rects.get(this);
    return r ? { ...zero, ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top } : zero;
  });
}

const holds = () => Object.keys(useOcclusion.getState().holds);

beforeEach(() => {
  useOcclusion.setState({ holds: {}, areas: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("occluding an element that is not a component", () => {
  it("covers the area the element takes while it is on the page, and lets go when told", () => {
    const menu = document.createElement("div");
    document.body.append(menu);
    layout(new Map([[menu, { left: 700, top: 50, right: 900, bottom: 200 }]]));
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(false);
    const release = occludeElement(menu);
    expect(holds()).toHaveLength(1);
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(true);
    release();
    expect(holds()).toEqual([]);
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(false);
  });

  it("covers nothing for an element that has no area or is no longer on the page", () => {
    const hidden = document.createElement("div");
    document.body.append(hidden);
    layout(new Map());
    const release = occludeElement(hidden);
    expect(holds()).toEqual([]);
    release();
    const gone = document.createElement("div");
    layout(new Map([[gone, { left: 0, top: 0, right: 900, bottom: 900 }]]));
    const releaseGone = occludeElement(gone);
    expect(holds()).toEqual([]);
    releaseGone();
  });

  it("follows the element when the editor moves it by its style, and when the window resizes or scrolls", async () => {
    const menu = document.createElement("div");
    document.body.append(menu);
    const rects = new Map([[menu, { left: 10, top: 10, right: 110, bottom: 60 }]]);
    layout(rects);
    const release = occludeElement(menu);
    // Away from the area: nothing is covered.
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(false);
    rects.set(menu, { left: 500, top: 300, right: 700, bottom: 400 });
    menu.style.left = "500px";
    await waitFor(() => expect(covered(useOcclusion.getState().holds, AREA)).toBe(true));
    rects.set(menu, { left: 10, top: 10, right: 110, bottom: 60 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(false);
    rects.set(menu, { left: 250, top: 150, right: 350, bottom: 250 });
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(true);
    release();
    // Nothing listens any more.
    rects.set(menu, { left: 250, top: 150, right: 350, bottom: 250 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(holds()).toEqual([]);
  });

  it("keeps each element's hold apart", () => {
    const one = document.createElement("div");
    const two = document.createElement("div");
    document.body.append(one, two);
    layout(
      new Map([
        [one, { left: 0, top: 0, right: 50, bottom: 50 }],
        [two, { left: 300, top: 200, right: 400, bottom: 300 }],
      ]),
    );
    const releaseOne = occludeElement(one);
    const releaseTwo = occludeElement(two);
    expect(holds()).toHaveLength(2);
    releaseOne();
    expect(holds()).toHaveLength(1);
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(true);
    releaseTwo();
    expect(holds()).toEqual([]);
  });
});

function Popup({ on = true }: { on?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useOccludesElement(ref, on);
  return <div ref={ref} role="menu" aria-label="Popup" />;
}

describe("useOccludesElement", () => {
  it("covers the component's element while it is mounted and shown", () => {
    const rects = new Map<Element, { left: number; top: number; right: number; bottom: number }>();
    layout(rects);
    const view = render(<Popup />);
    const menu = view.getByRole("menu");
    rects.set(menu, { left: 300, top: 200, right: 500, bottom: 400 });
    view.rerender(<Popup on={false} />);
    expect(holds()).toEqual([]);
    view.rerender(<Popup on />);
    expect(holds()).toHaveLength(1);
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(true);
    view.unmount();
    expect(holds()).toEqual([]);
  });
});
