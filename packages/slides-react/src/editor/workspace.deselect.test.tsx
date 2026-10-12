// Clicking away, inside the whole editor: bare background of the title bar lets go of what is selected on the slide; a control does not
// (a toolbar button works on the selection), and the editor takes the focus when nothing inside it can, so its keys still reach it.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "./factory.ts";
import { openDeck } from "./filmstrip/test-support.ts";
import { Workspace } from "./SlidesEditor.tsx";

afterEach(cleanup);

async function open() {
  const made = await openDeck({ slides: 2 });
  const [a] = made.session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
  const view = render(<Workspace session={made.session} ui={made.ui} />);
  act(() => made.session.select([a]));
  return { ...made, ...view, a };
}

describe("a press on the title bar", () => {
  it("lets go of what is selected on the slide when it is on bare background", async () => {
    const { session, container } = await open();
    fireEvent.pointerDown(container.querySelector<HTMLElement>(".ks-title-spacer")!, { button: 0 });
    expect(session.state.selection).toEqual([]);
  });

  it("keeps it when it is on a control", async () => {
    const { session, a, container } = await open();
    fireEvent.pointerDown(container.querySelector<HTMLElement>(".ks-titlebar button")!, { button: 0 });
    expect(session.state.selection).toEqual([a]);
  });

  it("keeps it for a press that adds to a selection, or that is not the main button", async () => {
    const { session, a, container } = await open();
    const spacer = container.querySelector<HTMLElement>(".ks-title-spacer")!;
    fireEvent.pointerDown(spacer, { button: 0, shiftKey: true });
    fireEvent.pointerDown(spacer, { button: 2 });
    expect(session.state.selection).toEqual([a]);
  });
});

describe("a press on a panel", () => {
  it("lets go on the part of it that holds nothing, and not between or on its controls", async () => {
    const { session, a, ui, container } = await open();
    act(() => ui.openPanel("format"));
    const body = container.querySelector<HTMLElement>(".ks-sp-body")!;
    const inside = body.firstElementChild as HTMLElement;
    fireEvent.pointerDown(inside, { button: 0 });
    fireEvent.pointerDown(body.querySelector<HTMLElement>("button, input")!, { button: 0 });
    expect(session.state.selection).toEqual([a]);
    fireEvent.pointerDown(body, { button: 0 });
    expect(session.state.selection).toEqual([]);
  });
});

describe("the toolbar", () => {
  it("is not bare background: a press on its blank gap or its buttons keeps the selection", async () => {
    const { session, a, container } = await open();
    fireEvent.pointerDown(container.querySelector<HTMLElement>(".ks-toolbar")!, { button: 0 });
    fireEvent.pointerDown(container.querySelector<HTMLElement>(".ks-toolbar button")!, { button: 0 });
    expect(session.state.selection).toEqual([a]);
  });
});

describe("the editor", () => {
  it("can take the focus itself, so that a press on a place nothing else can take it leaves the keys with the editor", async () => {
    const { container } = await open();
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("ks-editor")).toBe(true);
    expect(root.tabIndex).toBe(-1);
  });
});
