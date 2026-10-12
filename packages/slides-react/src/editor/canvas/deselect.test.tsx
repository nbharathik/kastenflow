// Clicking away. A press that is not on a block, a handle or the text being written clears what was selected: on empty space of
// the slide, on the grey stage round it, and while a text box is open (one press ends the edit and clears, it does not take two).
// A press that adds (Shift, Ctrl) or pans (the middle button, Space) never clears.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape, textBox } from "../factory.ts";
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
  const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!;
  return { session, ui, view, a, b, page: () => q(".ks-page"), stage: () => q(".ks-stage"), wrap: () => q(".ks-page-wrap") };
}

/** A click: the press and the release. */
const click = (target: HTMLElement, at: { clientX: number; clientY: number }, extra: Record<string, unknown> = {}) => {
  fireEvent.pointerDown(target, { button: 0, ...at, ...extra });
  fireEvent.pointerUp(target, { button: 0, ...at, ...extra });
};

describe("a press on the grey stage round the slide", () => {
  it("clears the selection, and the stage has the focus", async () => {
    const { session, a, stage } = await open();
    act(() => session.select([a]));
    click(stage(), { clientX: 5, clientY: 5 });
    expect(session.state.selection).toEqual([]);
    expect(document.activeElement).toBe(stage());
  });

  it("clears it from the padding round the page as well", async () => {
    const { session, a, b, wrap } = await open();
    act(() => session.select([a, b]));
    click(wrap(), { clientX: 5, clientY: 5 });
    expect(session.state.selection).toEqual([]);
  });

  it("leaves the group that was gone into, so the next press is on the slide itself", async () => {
    const { session, a, b, stage } = await open();
    act(() => session.select([a, b]));
    act(() => session.elements.group());
    const group = session.state.selection[0]!;
    const held = session.slide.elements.find((e) => e.id === group);
    act(() => session.enterGroup(group, held?.type === "group" ? held.children[0]?.id : undefined));
    expect(session.state.inside).toEqual([group]);
    click(stage(), { clientX: 5, clientY: 5 });
    expect(session.state.selection).toEqual([]);
    expect(session.state.inside).toEqual([]);
  });

  it("keeps the selection for a press that adds to it (Shift, Ctrl) and for one that pans (the middle button, Space)", async () => {
    const { session, a, stage } = await open();
    act(() => session.select([a]));
    click(stage(), { clientX: 5, clientY: 5 }, { shiftKey: true });
    click(stage(), { clientX: 5, clientY: 5 }, { ctrlKey: true });
    fireEvent.pointerDown(stage(), { button: 1, clientX: 5, clientY: 5, pointerId: 4 });
    fireEvent.pointerUp(stage(), { button: 1, clientX: 5, clientY: 5, pointerId: 4 });
    expect(session.state.selection).toEqual([a]);
    stage().focus();
    fireEvent.keyDown(stage(), { key: " ", code: "Space" });
    click(stage(), { clientX: 5, clientY: 5 });
    expect(session.state.selection).toEqual([a]);
  });

  it("leaves a press on the stage's own scroll bar to the scroll bar, which is not a click on the grey", async () => {
    const { session, a, stage } = await open();
    act(() => session.select([a]));
    // A stage with room 500 by 400 whose scroll bars are the strip beyond that.
    Object.defineProperty(stage(), "clientWidth", { configurable: true, value: 500 });
    Object.defineProperty(stage(), "clientHeight", { configurable: true, value: 400 });
    click(stage(), { clientX: 510, clientY: 100 });
    click(stage(), { clientX: 100, clientY: 410 });
    expect(session.state.selection).toEqual([a]);
    click(stage(), { clientX: 100, clientY: 100 });
    expect(session.state.selection).toEqual([]);
  });

  it("leaves nothing for Delete to take: the key does not delete what was selected before the press", async () => {
    const { session, a, stage } = await open();
    const before = session.slide.elements.length;
    act(() => session.select([a]));
    click(stage(), { clientX: 5, clientY: 5 });
    fireEvent.keyDown(stage(), { key: "Delete" });
    expect(session.slide.elements).toHaveLength(before);
  });

  it("does not clear the selection for a press on a block, which picks it", async () => {
    const { session, a, b, page } = await open();
    act(() => session.select([a]));
    click(page(), { clientX: 520, clientY: 320 });
    expect(session.state.selection).toEqual([b]);
  });
});

describe("a press on empty space of the slide", () => {
  it("clears the selection and the focus is on the stage", async () => {
    const { session, a, page, stage } = await open();
    act(() => session.select([a]));
    click(page(), { clientX: 700, clientY: 100 });
    expect(session.state.selection).toEqual([]);
    expect(document.activeElement).toBe(stage());
  });

  it("collapses several slides picked in the filmstrip to the one shown", async () => {
    const { session, a, page } = await open();
    const [first] = session.deck.slides.map((s) => s.id);
    const shown = session.state.slideId;
    act(() => session.selectSlides([first!, shown], shown));
    expect(session.state.slideSelection).toHaveLength(2);
    click(page(), { clientX: 700, clientY: 100 });
    expect(session.state.slideSelection).toEqual([shown]);
    expect(a).toBeTruthy();
  });
});

describe("a text box that is open for writing", () => {
  async function writing() {
    const made = await open();
    const [t] = made.session.elements.insert([textBox({ x: 100, y: 400, w: 400, h: 80 }, "Hello brave world")]) as [string];
    act(() => made.session.select([]));
    act(() => made.session.startEditing(t));
    return { ...made, t };
  }

  it("is left, and the selection cleared, by one press on empty space", async () => {
    const { session, page, stage } = await writing();
    expect(session.state.editing).not.toBeNull();
    click(page(), { clientX: 700, clientY: 100 });
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([]);
    expect(document.activeElement).toBe(stage());
  });

  it("is left, and the selection cleared, by one press on the grey stage", async () => {
    const { session, stage } = await writing();
    click(stage(), { clientX: 5, clientY: 5 });
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([]);
  });

  it("is left by a press on another block, which is the one selected then", async () => {
    const { session, b, page } = await writing();
    click(page(), { clientX: 520, clientY: 320 });
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([b]);
  });

  it("stays open, and selected, for a press inside the words", async () => {
    const { session, t, view } = await writing();
    fireEvent.pointerDown(view.container.querySelector<HTMLElement>(".ks-text-layer .ProseMirror")!, { button: 0, clientX: 150, clientY: 420 });
    expect(session.state.editing).toBe(t);
    expect(session.state.selection).toEqual([t]);
  });

  it("is left, and the selection kept, by Escape (the first Escape ends the edit, the second clears)", async () => {
    const { session, t, stage } = await writing();
    fireEvent.keyDown(stage(), { key: "Escape" });
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([t]);
    fireEvent.keyDown(stage(), { key: "Escape" });
    expect(session.state.selection).toEqual([]);
  });
});
