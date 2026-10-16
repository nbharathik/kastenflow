// A drag that begins on the grey round the slide draws a selection rectangle, as one from empty space on the slide does. The corner it
// begins at may be off the slide, so slide units can be negative; a click that goes nowhere still takes the selection off.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { SlideCanvas } from "./SlideCanvas.tsx";

afterEach(cleanup);

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
});

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.setZoom(1);
  session.slides.add({ layout: "blank" });
  const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), shape("ellipse", { x: 500, y: 300, w: 120, h: 120 })]) as [string, string];
  session.select([]);
  const view = render(<SlideCanvas session={session} ui={ui} />);
  const q = (selector: string) => view.container.querySelector<HTMLElement>(selector);
  return { session, ui, a, b, view, stage: () => q(".ks-stage")!, page: () => q(".ks-page")!, marquee: () => q(".ks-marquee") };
}

const at = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ button: 0, pointerId: 1, clientX, clientY, ...extra });

describe("a drag from the grey stage", () => {
  it("selects what the rectangle holds whole, though it began off the slide", async () => {
    const { session, a, stage } = await open();
    fireEvent.pointerDown(stage(), at(-20, -20));
    fireEvent.pointerMove(stage(), at(150, 120));
    fireEvent.pointerMove(stage(), at(320, 220));
    fireEvent.pointerUp(stage(), at(320, 220));
    expect(session.state.selection).toEqual([a]);
  });

  it("can take everything", async () => {
    const { session, a, b, stage } = await open();
    fireEvent.pointerDown(stage(), at(-20, -20));
    fireEvent.pointerMove(stage(), at(900, 600));
    fireEvent.pointerUp(stage(), at(900, 600));
    expect([...session.state.selection].sort()).toEqual([a, b].sort());
  });

  it("draws the rectangle with its corner off the slide while it is dragged, and takes it away when it ends", async () => {
    const { stage, marquee } = await open();
    fireEvent.pointerDown(stage(), at(-20, -30));
    fireEvent.pointerMove(stage(), at(150, 120));
    expect(marquee()).not.toBeNull();
    expect(marquee()?.style.left).toBe("-20px");
    expect(marquee()?.style.top).toBe("-30px");
    expect(marquee()?.style.width).toBe("170px");
    fireEvent.pointerUp(stage(), at(150, 120));
    expect(marquee()).toBeNull();
  });

  it("adds to the selection with Shift held, and keeps what was selected", async () => {
    const { session, a, b, stage } = await open();
    act(() => session.select([b]));
    fireEvent.pointerDown(stage(), at(-20, -20, { shiftKey: true }));
    fireEvent.pointerMove(stage(), at(320, 220, { shiftKey: true }));
    fireEvent.pointerUp(stage(), at(320, 220, { shiftKey: true }));
    expect([...session.state.selection].sort()).toEqual([a, b].sort());
  });

  it("replaces the selection without Shift, from the moment of the press", async () => {
    const { session, a, b, stage } = await open();
    act(() => session.select([b]));
    fireEvent.pointerDown(stage(), at(-20, -20));
    expect(session.state.selection).toEqual([]);
    fireEvent.pointerMove(stage(), at(320, 220));
    fireEvent.pointerUp(stage(), at(320, 220));
    expect(session.state.selection).toEqual([a]);
  });

  it("is a click that clears the selection when the pointer did not move", async () => {
    const { session, a, stage } = await open();
    act(() => session.select([a]));
    fireEvent.pointerDown(stage(), at(5, 5));
    fireEvent.pointerUp(stage(), at(5, 5));
    expect(session.state.selection).toEqual([]);
  });

  it("is called off by Escape: nothing is selected and the rectangle goes", async () => {
    const { session, stage, marquee } = await open();
    fireEvent.pointerDown(stage(), at(-20, -20));
    fireEvent.pointerMove(stage(), at(900, 600));
    expect(marquee()).not.toBeNull();
    fireEvent.keyDown(stage(), { key: "Escape" });
    expect(marquee()).toBeNull();
    fireEvent.pointerUp(stage(), at(900, 600));
    expect(session.state.selection).toEqual([]);
  });

  it("does not begin with the middle button, which pans", async () => {
    const { stage, marquee } = await open();
    fireEvent.pointerDown(stage(), at(-20, -20, { button: 1 }));
    fireEvent.pointerMove(stage(), at(150, 120));
    expect(marquee()).toBeNull();
    fireEvent.pointerUp(stage(), at(150, 120, { button: 1 }));
  });

  it("does not begin with a drawing tool armed: the press is the start of a shape there, which the page takes", async () => {
    const { session, stage, marquee } = await open();
    act(() => session.setTool("text"));
    fireEvent.pointerDown(stage(), at(-20, -20));
    fireEvent.pointerMove(stage(), at(150, 120));
    expect(marquee()).toBeNull();
    fireEvent.pointerUp(stage(), at(150, 120));
  });

  it("does not take over a drag that began on the slide: a block moves by what the pointer moved, once", async () => {
    const { session, a, page } = await open();
    fireEvent.pointerDown(page(), at(150, 150));
    fireEvent.pointerMove(page(), at(190, 180));
    fireEvent.pointerUp(page(), at(190, 180));
    const moved = session.slide.elements.find((e) => e.id === a);
    expect(moved).toMatchObject({ x: expect.any(Number) });
    expect(Math.abs((moved as { x: number }).x - 140)).toBeLessThan(7);
  });
});
