// Alt held over another block shows how far the selection is from it.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { DistanceLabels } from "./DistanceLabels.tsx";
import { SlideCanvas } from "./SlideCanvas.tsx";

afterEach(cleanup);

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
});

describe("the distance labels", () => {
  it("draw a line and a size for each gap, in pixels at the zoom", () => {
    const view = render(<DistanceLabels from={{ x: 0, y: 0, w: 100, h: 50 }} to={{ x: 150, y: 10, w: 50, h: 100 }} zoom={2} />);
    const marks = view.container.querySelectorAll<HTMLElement>(".ks-distance");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.dataset.axis).toBe("x");
    expect(marks[0]?.style.left).toBe("200px");
    expect(marks[0]?.style.top).toBe("60px");
    expect(marks[0]?.style.width).toBe("100px");
    expect(marks[0]?.textContent).toBe("50");
  });

  it("draw nothing for blocks that touch, or when either is missing", () => {
    expect(render(<DistanceLabels from={{ x: 0, y: 0, w: 100, h: 50 }} to={{ x: 100, y: 0, w: 50, h: 50 }} zoom={1} />).container.querySelector(".ks-distance")).toBeNull();
    cleanup();
    expect(render(<DistanceLabels from={null} to={{ x: 0, y: 0, w: 5, h: 5 }} zoom={1} />).container.querySelector(".ks-distance")).toBeNull();
    cleanup();
    expect(render(<DistanceLabels from={{ x: 0, y: 0, w: 5, h: 5 }} to={null} zoom={1} />).container.querySelector(".ks-distance")).toBeNull();
  });
});

describe("Alt on the canvas", () => {
  async function open() {
    const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
    const ui = new EditorUi();
    ui.setZoom(1);
    session.slides.add({ layout: "blank" });
    const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), shape("ellipse", { x: 500, y: 100, w: 120, h: 120 })]) as [string, string];
    session.select([a]);
    const view = render(<SlideCanvas session={session} ui={ui} />);
    return { session, a, b, view, page: () => view.container.querySelector<HTMLElement>(".ks-page")! };
  }

  it("shows the gap between the selection and the block under the pointer while Alt is held, and not after", async () => {
    const { view, page } = await open();
    fireEvent.pointerMove(page(), { clientX: 540, clientY: 140 });
    expect(view.container.querySelector(".ks-distance")).toBeNull();
    act(() => void fireEvent.keyDown(window, { key: "Alt" }));
    const marks = view.container.querySelectorAll(".ks-distance");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("200");
    act(() => void fireEvent.keyUp(window, { key: "Alt" }));
    expect(view.container.querySelector(".ks-distance")).toBeNull();
  });

  it("shows nothing over the selection itself, or with nothing selected", async () => {
    const { session, view, page } = await open();
    fireEvent.pointerMove(page(), { clientX: 140, clientY: 140 });
    act(() => void fireEvent.keyDown(window, { key: "Alt" }));
    expect(view.container.querySelector(".ks-distance")).toBeNull();
    act(() => session.select([]));
    fireEvent.pointerMove(page(), { clientX: 540, clientY: 140 });
    expect(view.container.querySelector(".ks-distance")).toBeNull();
    act(() => void fireEvent.keyUp(window, { key: "Alt" }));
  });

  it("is let go when the window loses the focus with Alt down", async () => {
    const { view, page } = await open();
    fireEvent.pointerMove(page(), { clientX: 540, clientY: 140 });
    act(() => void fireEvent.keyDown(window, { key: "Alt" }));
    expect(view.container.querySelector(".ks-distance")).not.toBeNull();
    act(() => void fireEvent.blur(window));
    expect(view.container.querySelector(".ks-distance")).toBeNull();
  });
});
