// Keys that fall on the page. Open a deck, and the focus stays on the body: Delete, Ctrl+Z, Ctrl+C and Ctrl+V did nothing until a click.
// With the host's say-so (`routeOrphanKeys`) they go to the editor; never from a field, a dialog or a presentation, and never plain typing.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KASTEN_TYPE } from "../clipboard/format.ts";
import { forget } from "../clipboard/store.ts";
import { shape } from "../factory.ts";
import { openDeck } from "../filmstrip/test-support.ts";
import { Workspace } from "../SlidesEditor.tsx";
import { expectFocusIn, expectFocusOn } from "./testing.ts";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
beforeEach(forget);

/** What a clipboard event carries: types by name. */
function transfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => void data.set(type, value), files: [] as File[], data };
}

async function open(props: { routeOrphanKeys?: () => boolean; autoFocus?: boolean; focusKey?: unknown } = {}) {
  const made = await openDeck({ slides: 2 });
  const [a] = made.session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
  const view = render(<Workspace session={made.session} ui={made.ui} {...props} />);
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  const notes = () => view.container.querySelector<HTMLElement>(".ks-notes textarea, textarea")!;
  const has = (id: string) => made.session.slide.elements.some((element) => element.id === id);
  return { ...made, ...view, a, stage, notes, has };
}

const key = (target: Element, init: KeyboardEventInit) => fireEvent.keyDown(target, init);
const dropFocus = () => (document.activeElement as HTMLElement | null)?.blur();

describe("a key that falls on the page", () => {
  it("does nothing when the host has not said this editor is in use (the bug: Delete after opening a deck)", async () => {
    const { session, a, has } = await open();
    act(() => session.select([a]));
    expectFocusOn(document.body);
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(true);
    expectFocusOn(document.body);
  });

  it("deletes the selected block, and the slide takes the keys, when the host says it is in use", async () => {
    const { session, a, has, stage } = await open({ routeOrphanKeys: () => true });
    act(() => session.select([a]));
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(false);
    expectFocusOn(stage());
  });

  it("undoes with Ctrl+Z and redoes with Ctrl+Shift+Z", async () => {
    const { a, has } = await open({ routeOrphanKeys: () => true });
    expect(has(a)).toBe(true);
    key(document.body, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(has(a)).toBe(false);
    // The slide has the keys now, as it would have for a person.
    key(document.activeElement!, { key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true });
    expect(has(a)).toBe(true);
  });

  it("asks the host each time, so a pane that is no longer in use stops taking keys", async () => {
    let active = true;
    const { session, a, has } = await open({ routeOrphanKeys: () => active });
    act(() => session.select([a]));
    active = false;
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(true);
    active = true;
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(false);
  });

  it("gives the slide the keys for a key only the slide handles (an arrow), and takes nothing else", async () => {
    const { stage } = await open({ routeOrphanKeys: () => true });
    expectFocusOn(document.body);
    const dispatched = key(document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(dispatched).toBe(true);
    expectFocusOn(stage());
  });

  it("is left alone for plain typing, Tab, Escape and a modifier by itself", async () => {
    await open({ routeOrphanKeys: () => true });
    for (const init of [{ key: "t", code: "KeyT" }, { key: " ", code: "Space" }, { key: "Tab", code: "Tab" }, { key: "Escape", code: "Escape" }, { key: "Shift", code: "ShiftLeft" }, { key: "Control", code: "ControlLeft", ctrlKey: true }]) {
      key(document.body, init);
      expectFocusOn(document.body);
    }
  });

  it("is left alone while a field has the focus", async () => {
    const { session, a, has, notes } = await open({ routeOrphanKeys: () => true });
    act(() => session.select([a]));
    const field = notes();
    field.focus();
    key(field, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(true);
    expectFocusOn(field);
    // A key that fell on the body while a field has the focus is not an orphan either.
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(true);
  });

  it("is left alone while a dialog is open, and while a presentation is open", async () => {
    const { session, a, has, ui } = await open({ routeOrphanKeys: () => true });
    act(() => session.select([a]));
    act(() => ui.openDialog("shortcuts"));
    dropFocus();
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(true);
    act(() => ui.openDialog(null));
    const show = document.createElement("div");
    show.className = "ks-show-root";
    document.body.append(show);
    dropFocus();
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(true);
    show.remove();
    dropFocus();
    key(document.body, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(false);
  });

  it("is taken by the one editor that is in use when there are two", async () => {
    const first = await open({ routeOrphanKeys: () => false });
    const second = await openDeck({ slides: 2 });
    const [b] = second.session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    const other = render(<Workspace session={second.session} ui={second.ui} routeOrphanKeys={() => true} />);
    act(() => first.session.select([first.a]));
    act(() => second.session.select([b]));
    key(document.body, { key: "Delete", code: "Delete" });
    expect(first.has(first.a)).toBe(true);
    expect(second.session.slide.elements.some((element) => element.id === b)).toBe(false);
    expectFocusIn(other.container);
  });
});

describe("the clipboard on the page", () => {
  it("says it can copy and paste, so that the browser makes the events of the keys", async () => {
    const { session, a } = await open({ routeOrphanKeys: () => true });
    act(() => session.select([]));
    const ask = (type: string) => !document.body.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    // Nothing selected: nothing to copy; a paste is always welcome.
    expect(ask("beforecopy")).toBe(false);
    expect(ask("beforepaste")).toBe(true);
    act(() => session.select([a]));
    expect(ask("beforecopy")).toBe(true);
    expect(ask("beforecut")).toBe(true);
  });

  it("copies the selected block and pastes it, with the data on the event", async () => {
    const { session, a, stage } = await open({ routeOrphanKeys: () => true });
    act(() => session.select([a]));
    const data = transfer();
    expect(fireEvent.copy(document.body, { clipboardData: data })).toBe(false);
    expect(JSON.parse(data.data.get(KASTEN_TYPE)!)).toMatchObject({ kind: "elements" });
    expectFocusOn(stage());
    const count = session.slide.elements.length;
    // The page again, as when the focus was lost once more.
    dropFocus();
    fireEvent.paste(document.body, { clipboardData: data });
    expect(session.slide.elements).toHaveLength(count + 1);
  });

  it("cuts the selected block", async () => {
    const { session, a, has } = await open({ routeOrphanKeys: () => true });
    act(() => session.select([a]));
    const data = transfer();
    fireEvent.cut(document.body, { clipboardData: data });
    expect(has(a)).toBe(false);
    expect(data.data.has(KASTEN_TYPE)).toBe(true);
  });

  it("leaves the events to the page when the host has not said so, or a field has the focus", async () => {
    const quiet = await open();
    act(() => quiet.session.select([quiet.a]));
    const data = transfer();
    expect(fireEvent.copy(document.body, { clipboardData: data })).toBe(true);
    expect(data.data.size).toBe(0);
    cleanup();
    const loud = await open({ routeOrphanKeys: () => true });
    act(() => loud.session.select([loud.a]));
    loud.notes().focus();
    const more = transfer();
    expect(fireEvent.copy(document.body, { clipboardData: more })).toBe(true);
    expect(more.data.size).toBe(0);
  });
});

describe("a window that comes back, and a deck that was just opened", () => {
  it("gives the slide the keys when the window gets the focus back with nothing focused", async () => {
    const { stage } = await open({ routeOrphanKeys: () => true });
    expectFocusOn(document.body);
    fireEvent.focus(window);
    expectFocusOn(stage());
  });

  it("leaves a window alone that comes back to a field", async () => {
    const { notes } = await open({ routeOrphanKeys: () => true });
    const field = notes();
    field.focus();
    fireEvent.focus(window);
    expectFocusOn(field);
  });

  it("autoFocus gives the slide the keys as the deck is shown, without a host predicate", async () => {
    const { stage, session, a, has } = await open({ autoFocus: true });
    expectFocusOn(stage());
    act(() => session.select([a]));
    key(document.activeElement!, { key: "Delete", code: "Delete" });
    expect(has(a)).toBe(false);
  });

  it("focusKey gives the slide the keys again each time it becomes a new value that is not false", async () => {
    const made = await open({ focusKey: false });
    expectFocusOn(document.body);
    const draw = (focusKey: unknown) => made.rerender(<Workspace session={made.session} ui={made.ui} focusKey={focusKey} />);
    draw(1);
    expectFocusOn(made.stage());
    dropFocus();
    draw(1);
    expectFocusOn(document.body);
    draw(2);
    expectFocusOn(made.stage());
    dropFocus();
    draw(null);
    expectFocusOn(document.body);
  });
});
