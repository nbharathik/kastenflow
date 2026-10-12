// The move handle on the slide: when it is shown, where, and what a press on it does, in the canvas as a person meets it.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape, textBox } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { SlideCanvas } from "./SlideCanvas.tsx";

afterEach(cleanup);

// The page reads pointer capture, which jsdom has no notion of.
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
});

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.setZoom(1);
  ui.toggleSnap();
  session.slides.add({ layout: "blank" });
  const [a, b, words] = session.elements.insert([
    shape("rect", { x: 100, y: 100, w: 200, h: 100 }),
    shape("ellipse", { x: 500, y: 300, w: 120, h: 120 }),
    textBox({ x: 100, y: 400, w: 400, h: 80 }, "Hello brave world"),
  ]) as [string, string, string];
  session.select([]);
  const view = render(<SlideCanvas session={session} ui={ui} />);
  const page = () => view.container.querySelector<HTMLElement>(".ks-page")!;
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  const chips = () => [...view.container.querySelectorAll<HTMLElement>(".ks-move")];
  const chip = (id = "") => view.container.querySelector<HTMLElement>(`.ks-move[data-move="${id}"]`);
  const find = (id: string) => session.slide.elements.find((e) => e.id === id)!;
  const hover = (x: number, y: number) => fireEvent.pointerMove(page(), { clientX: x, clientY: y });
  return { session, ui, view, page, stage, chips, chip, find, hover, a, b, words };
}

describe("the move handle of a selected block", () => {
  it("is not there with nothing selected or hovered", async () => {
    const { chips } = await open();
    expect(chips()).toHaveLength(0);
  });

  it("is a chip named Move outside the block's top left corner, in screen pixels", async () => {
    const { session, a, chip } = await open();
    act(() => session.select([a]));
    const handle = chip()!;
    expect(handle).toBeTruthy();
    expect(handle.getAttribute("aria-label")).toBe("Move");
    expect(handle.getAttribute("title")).toBe("Drag to move (arrow keys nudge)");
    // 24 px, 6 px clear of the corner (100, 100) that the block's resize handle is on.
    expect(handle.style.left).toBe("70px");
    expect(handle.style.top).toBe("70px");
    expect(handle.classList.contains("is-inside")).toBe(false);
    expect(handle.classList.contains("is-selection")).toBe(true);
  });

  it("keeps the same size when the zoom changes, and follows the block", async () => {
    const { session, ui, a, chip } = await open();
    act(() => session.select([a]));
    act(() => ui.setZoom(2));
    // The block's corner is at (200, 200) on the screen now; the chip is still 24 px and 6 px clear.
    expect(chip()!.style.left).toBe("170px");
    expect(chip()!.style.top).toBe("170px");
    act(() => ui.setZoom(0.5));
    expect(chip()!.style.left).toBe("20px");
  });

  it("goes inside the corner of a block that is against the top or the left of the slide", async () => {
    const { session, a, chip } = await open();
    act(() => void session.elements.transform([{ id: a, x: 0, y: 0 }]));
    act(() => session.select([a]));
    expect(chip()!.classList.contains("is-inside")).toBe(true);
    expect(chip()!.style.left).toBe("6px");
    expect(chip()!.style.top).toBe("6px");
  });

  it("is one on the box round several selected blocks", async () => {
    const { session, a, b, chips } = await open();
    act(() => session.select([a, b]));
    expect(chips()).toHaveLength(1);
    // The box round both begins at (100, 100).
    expect(chips()[0]!.style.left).toBe("70px");
    expect(chips()[0]!.style.top).toBe("70px");
  });

  it("is not on a block that is locked, or a drawing tool is in hand", async () => {
    const { session, a, chips } = await open();
    act(() => session.elements.lock(true, [a]));
    act(() => session.select([a]));
    expect(chips()).toHaveLength(0);
    act(() => session.elements.lock(false, [a]));
    expect(chips()).toHaveLength(1);
    act(() => session.setTool("shape:rect"));
    expect(chips()).toHaveLength(0);
  });

  it("stays while the text of the box is being edited", async () => {
    const { session, words, view, chip } = await open();
    act(() => session.startEditing(words));
    expect(view.container.querySelector(".ks-text-layer")).toBeTruthy();
    expect(chip()).toBeTruthy();
  });

  it("is in the overlay and never in the slide", async () => {
    const { session, a, view } = await open();
    act(() => session.select([a]));
    expect(view.container.querySelector(".ks-overlay .ks-move")).toBeTruthy();
    expect(view.container.querySelector(".ks-page-scale .ks-move")).toBeNull();
  });
});

describe("the lighter handle of a block that is hovered", () => {
  it("shows on an unselected block under the pointer, and goes when the pointer goes", async () => {
    const { chip, hover, page, a, chips } = await open();
    hover(150, 130);
    expect(chip(a)!.classList.contains("is-hover")).toBe(true);
    expect(chip(a)!.style.left).toBe("70px");
    hover(800, 500);
    expect(chips()).toHaveLength(0);
    hover(150, 130);
    expect(chips()).toHaveLength(1);
    fireEvent.pointerLeave(page());
    expect(chips()).toHaveLength(0);
  });

  it("stays while the pointer is on the handle, out beyond the block, on its way there", async () => {
    const { chip, hover, a, chips } = await open();
    hover(150, 130);
    // The handle is at (70, 70) to (94, 94): the pointer is over it, not over the block.
    fireEvent.pointerMove(chip(a)!.querySelector("svg")!, { clientX: 80, clientY: 80 });
    expect(chips()).toHaveLength(1);
    expect(chip(a)).toBeTruthy();
    // Off the handle and off the block: gone.
    hover(30, 30);
    expect(chips()).toHaveLength(0);
  });

  it("is replaced by the block's own handle once it is selected, and shows beside it on another block", async () => {
    const { session, a, b, chip, hover, chips } = await open();
    hover(150, 130);
    act(() => session.select([a]));
    expect(chips()).toHaveLength(1);
    expect(chip()!.classList.contains("is-selection")).toBe(true);
    hover(560, 350);
    expect(chips().map((c) => c.classList.contains("is-hover"))).toEqual([false, true]);
    expect(chip(b)).toBeTruthy();
  });

  it("is not on a locked block, or with a drawing tool in hand", async () => {
    const { session, a, hover, chips } = await open();
    act(() => session.elements.lock(true, [a]));
    hover(150, 130);
    expect(chips()).toHaveLength(0);
    act(() => session.elements.lock(false, [a]));
    act(() => session.setTool("text"));
    hover(150, 130);
    expect(chips()).toHaveLength(0);
  });
});

describe("a drag from the handle", () => {
  it("moves the selected block by the distance dragged, in one step of undo", async () => {
    const { session, a, chip, page, find } = await open();
    act(() => session.select([a]));
    const revision = session.state.revision;
    // What a press lands on in a browser is the icon inside the chip.
    fireEvent.pointerDown(chip()!.querySelector("svg")!, { button: 0, clientX: 80, clientY: 80 });
    fireEvent.pointerMove(page(), { clientX: 130, clientY: 110 });
    // While it goes on the block is drawn where the pointer has taken it (slid by the browser, not drawn again), and the deck is as it was.
    expect(find(a)).toMatchObject({ x: 100, y: 100 });
    expect(chip()!.style.translate).toBe("50px 30px");
    expect(page().querySelector<HTMLElement>(`[data-el="${a}"]`)!.style.translate).toBe("50px 30px");
    expect(chip()!.classList.contains("is-dragging")).toBe(true);
    expect(page().style.cursor).toBe("grabbing");
    fireEvent.pointerUp(page(), { clientX: 130, clientY: 110 });
    expect(find(a)).toMatchObject({ x: 150, y: 130 });
    expect(session.state.revision).toBe(revision + 1);
    expect(session.state.selection).toEqual([a]);
    expect(chip()!.classList.contains("is-dragging")).toBe(false);
    expect(page().style.cursor).toBe("");
    // Nothing the drag wrote to the page is left: the deck says where the block is now.
    expect(chip()!.style.translate).toBe("");
    expect(page().querySelector<HTMLElement>(`[data-el="${a}"]`)!.style.translate).toBe("");
    expect(page().querySelector<HTMLElement>(`[data-el="${a}"]`)!.style.left).toBe("150px");
    session.undo();
    expect(find(a)).toMatchObject({ x: 100, y: 100 });
  });

  it("selects an unselected block and moves it, from its lighter handle", async () => {
    const { session, a, b, chip, hover, page, find } = await open();
    act(() => session.select([b]));
    hover(150, 130);
    fireEvent.pointerDown(chip(a)!.querySelector("svg")!, { button: 0, clientX: 80, clientY: 80 });
    expect(session.state.selection).toEqual([a]);
    fireEvent.pointerMove(page(), { clientX: 180, clientY: 80 });
    fireEvent.pointerUp(page(), { clientX: 180, clientY: 80 });
    expect(find(a)).toMatchObject({ x: 200, y: 100 });
    expect(find(b)).toMatchObject({ x: 500, y: 300 });
  });

  it("moves a text box that is being edited without ending the edit, or taking the focus from its text", async () => {
    const { session, words, chip, page, find, view } = await open();
    act(() => session.startEditing(words));
    const editor = view.container.querySelector<HTMLElement>(".ks-text-layer .ProseMirror")!;
    expect(document.activeElement).toBe(editor);
    fireEvent.pointerDown(chip()!.querySelector("svg")!, { button: 0, clientX: 80, clientY: 380 });
    // The press did not take the focus, and the edit is on.
    expect(document.activeElement).toBe(editor);
    expect(session.state.editing).toBe(words);
    fireEvent.pointerMove(page(), { clientX: 180, clientY: 350 });
    // The editor goes with the box while the drag is only shown.
    expect(view.container.querySelector<HTMLElement>(".ks-text-layer")!.style.translate).toBe("100px -30px");
    fireEvent.pointerUp(page(), { clientX: 180, clientY: 350 });
    expect(find(words)).toMatchObject({ x: 200, y: 370 });
    expect(session.state.editing).toBe(words);
    expect(document.activeElement).toBe(editor);
    expect(view.container.querySelector(".ks-text-layer")).toBeTruthy();
  });

  it("does not let the browser take the focus or the selection on the mouse press", async () => {
    const { session, a, chip } = await open();
    act(() => session.select([a]));
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    chip()!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    // Nor does the text editor take the press for a click away from it.
    expect(chip()!.hasAttribute("data-ks-keep-focus")).toBe(true);
  });

  it("ends the edit of another box when it is the handle of a different block that is pressed", async () => {
    const { session, words, a, chip, hover } = await open();
    act(() => session.startEditing(words));
    hover(150, 130);
    fireEvent.pointerDown(chip(a)!, { button: 0, clientX: 80, clientY: 80 });
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([a]);
    fireEvent.pointerUp(chip(a) ?? document.body, { clientX: 80, clientY: 80 });
  });

  it("shows the cursor of what is under the pointer: writing over a text box, moving over a block that is selected", async () => {
    const { session, a, words, page, hover } = await open();
    hover(150, 130);
    expect(page().style.cursor).toBe("");
    act(() => session.select([a]));
    hover(150, 130);
    expect(page().style.cursor).toBe("move");
    hover(150, 430);
    expect(page().style.cursor).toBe("text");
    act(() => session.select([words]));
    hover(150, 430);
    expect(page().style.cursor).toBe("text");
    hover(800, 500);
    expect(page().style.cursor).toBe("");
  });

  it("is a press like any other for a right-click, which opens the menu of the block", async () => {
    const { session, ui, a, b, chip } = await open();
    act(() => session.select([a, b]));
    fireEvent.contextMenu(chip()!.querySelector("svg")!, { clientX: 80, clientY: 80 });
    expect(ui.state.contextMenu?.kind).toBe("element");
    expect(session.state.selection).toEqual([a, b]);
  });
});

describe("the arrow keys, which the handle's tooltip names", () => {
  it("nudge the selection by 1, and by 10 with Shift", async () => {
    const { session, a, stage, find } = await open();
    act(() => session.select([a]));
    fireEvent.keyDown(stage(), { key: "ArrowRight" });
    expect(find(a)).toMatchObject({ x: 101, y: 100 });
    fireEvent.keyDown(stage(), { key: "ArrowDown", shiftKey: true });
    expect(find(a)).toMatchObject({ x: 101, y: 110 });
  });
});

describe("the keys that add things, on the slide", () => {
  it("adds a text box at the pointer with T, opens it, and takes it away again if it is closed empty", async () => {
    const { session, ui, stage, page, hover, view } = await open();
    // The page is at the window's top left in a test, so a place in the window is the same place on the slide.
    hover(400, 200);
    stage().focus();
    fireEvent.keyDown(stage(), { key: "t", code: "KeyT" });
    const made = session.slide.elements.at(-1)!;
    expect(made).toMatchObject({ type: "text", x: 400, y: 200 });
    expect(session.state.editing).toBe(made.id);
    expect(ui.state.text).not.toBeNull();
    expect(view.container.querySelector(".ks-text-layer")).toBeTruthy();
    const count = session.slide.elements.length;
    // Escape closes the box with nothing typed in it.
    fireEvent.keyDown(view.container.querySelector(".ks-text-layer .ProseMirror")!, { key: "Escape" });
    expect(session.state.editing).toBeNull();
    expect(session.slide.elements).toHaveLength(count - 1);
    expect(session.slide.elements.some((e) => e.id === made.id)).toBe(false);
    expect(page()).toBeTruthy();
  });

  it("does nothing for T while the box being edited has the keys: it is typing", async () => {
    const { session, words, view } = await open();
    act(() => session.startEditing(words));
    const count = session.slide.elements.length;
    fireEvent.keyDown(view.container.querySelector(".ks-text-layer .ProseMirror")!, { key: "t", code: "KeyT" });
    expect(session.slide.elements).toHaveLength(count);
    expect(session.state.editing).toBe(words);
  });
});
