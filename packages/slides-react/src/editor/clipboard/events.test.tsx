// Copy, cut and paste the way a person does them: the keys make the browser's copy, cut and paste events, and the editor answers them
// wherever the focus is in it (the slide, the filmstrip, the grid, a toolbar button), with the data on the event and no permission to ask.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shape, textBox } from "../factory.ts";
import { type Made, idsOf, openDeck } from "../filmstrip/test-support.ts";
import { Workspace } from "../SlidesEditor.tsx";
import { KASTEN_TYPE } from "./format.ts";
import { forget } from "./store.ts";

afterEach(cleanup);
beforeEach(forget);

/** What a clipboard event carries: types by name, and files. */
function transfer(initial: Record<string, string> = {}, files: File[] = []) {
  const data = new Map(Object.entries(initial));
  return { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => void data.set(type, value), files, data };
}
type Transfer = ReturnType<typeof transfer>;

async function open(slides = 3) {
  const made = await openDeck({ slides });
  const { session } = made;
  session.slides.add({ layout: "blank" });
  const work = session.state.slideId;
  const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), textBox({ x: 400, y: 300, w: 300, h: 60 }, "Some words")]) as [string, string];
  session.select([]);
  const view = render(<Workspace session={session} ui={made.ui} />);
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  const list = () => screen.getByRole("listbox", { name: "Slides" });
  const at = (id: string) => session.slide.elements.find((e) => e.id === id)!;
  return { ...made, view, stage, list, work, a, b, at };
}

/** A copy on the stage, whose data a paste anywhere reads. */
function copied(made: Made, ids: string[], target: HTMLElement, event: "copy" | "cut" = "copy"): { data: Transfer; prevented: boolean } {
  act(() => made.session.select(ids));
  const data = transfer();
  const dispatched = fireEvent[event](target, { clipboardData: data });
  return { data, prevented: !dispatched };
}

describe("a copy", () => {
  it("puts the blocks on the event three ways: the Kasten type, HTML that carries them, and their words", async () => {
    const made = await open();
    const { data, prevented } = copied(made, [made.a, made.b], made.stage());
    expect(prevented).toBe(true);
    expect(JSON.parse(data.data.get(KASTEN_TYPE)!)).toMatchObject({ kind: "elements" });
    expect(data.data.get("text/html")).toContain("data-kasten-slides=");
    // The words of the text box, and a word for the shape that has none: what a paste into another program shows.
    expect(data.data.get("text/plain")).toBe("Shape\nSome words");
  });

  it("leaves the event alone with nothing selected, so the browser copies what it would", async () => {
    const made = await open();
    const { data, prevented } = copied(made, [], made.stage());
    expect(prevented).toBe(false);
    expect(data.data.size).toBe(0);
  });

  it("works from a toolbar button, the title bar and the editor itself: the focus need not be on the slide", async () => {
    const made = await open();
    for (const target of [made.view.container.querySelector<HTMLElement>(".ks-toolbar button")!, made.view.container.querySelector<HTMLElement>(".ks-title-spacer")!, made.view.container.firstElementChild as HTMLElement]) {
      const { data, prevented } = copied(made, [made.a], target);
      expect(prevented).toBe(true);
      expect(data.data.has(KASTEN_TYPE)).toBe(true);
    }
  });

  it("is left to a field, to the text box being written and to a dialog", async () => {
    const made = await open();
    act(() => made.session.select([made.a]));
    const field = made.view.container.querySelector<HTMLElement>(".ks-notes textarea, textarea")!;
    const fieldData = transfer();
    expect(fireEvent.copy(field, { clipboardData: fieldData })).toBe(true);
    expect(fieldData.data.size).toBe(0);
  });

  it("does not take the key itself: Ctrl+C is the browser's, so that the event comes", async () => {
    const made = await open();
    act(() => made.session.select([made.a]));
    made.stage().focus();
    expect(fireEvent.keyDown(made.stage(), { key: "c", code: "KeyC", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(made.stage(), { key: "x", code: "KeyX", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(made.stage(), { key: "v", code: "KeyV", ctrlKey: true })).toBe(true);
    expect(made.session.slide.elements).toHaveLength(2);
  });
});

describe("a cut", () => {
  it("copies and removes, in one step of undo, and a paste puts the blocks back where they were", async () => {
    const made = await open();
    const { session, a } = made;
    const before = session.slide.elements.length;
    const { data } = copied(made, [a], made.stage(), "cut");
    expect(session.slide.elements).toHaveLength(before - 1);
    fireEvent.paste(made.stage(), { clipboardData: data });
    const [back] = session.state.selection as [string];
    expect([made.at(back).x, made.at(back).y]).toEqual([100, 100]);
    act(() => session.undo());
    act(() => session.undo());
    expect(session.slide.elements).toHaveLength(before);
  });
});

describe("a paste", () => {
  it("puts the blocks 16 down and right of the ones copied, selects them, and makes one step of undo; the next is 16 further", async () => {
    const made = await open();
    const { session, a } = made;
    const { data } = copied(made, [a], made.stage());
    const count = session.slide.elements.length;
    const revision = session.state.revision;
    fireEvent.paste(made.stage(), { clipboardData: data });
    const [one] = session.state.selection as [string];
    expect([made.at(one).x, made.at(one).y]).toEqual([116, 116]);
    expect(session.state.revision).toBe(revision + 1);
    fireEvent.paste(made.stage(), { clipboardData: data });
    const [two] = session.state.selection as [string];
    expect([made.at(two).x, made.at(two).y]).toEqual([132, 132]);
    act(() => session.undo());
    act(() => session.undo());
    expect(session.slide.elements).toHaveLength(count);
  });

  it("is where the blocks were on another slide, and in place when asked (Ctrl+Shift+V, then the paste the browser makes of it)", async () => {
    const made = await open();
    const { session, a } = made;
    const { data } = copied(made, [a], made.stage());
    act(() => void session.slides.add({ layout: "blank" }));
    fireEvent.paste(made.stage(), { clipboardData: data });
    const [there] = session.state.selection as [string];
    expect([made.at(there).x, made.at(there).y]).toEqual([100, 100]);
    made.stage().focus();
    fireEvent.keyDown(made.stage(), { key: "V", code: "KeyV", ctrlKey: true, shiftKey: true });
    fireEvent.paste(made.stage(), { clipboardData: data });
    const [placed] = session.state.selection as [string];
    expect([made.at(placed).x, made.at(placed).y]).toEqual([100, 100]);
  });

  it("works with the focus in the filmstrip: the blocks go on the slide shown", async () => {
    const made = await open();
    const { session, a } = made;
    const { data } = copied(made, [a], made.stage());
    made.list().focus();
    fireEvent.paste(made.list(), { clipboardData: data });
    expect(session.slide.elements.filter((e) => e.type === "shape")).toHaveLength(2);
  });

  it("takes a copy from another deck (the type, or the HTML when a webview keeps only the standard types)", async () => {
    const from = await open();
    const { data } = copied(from, [from.a, from.b], from.stage());
    cleanup();
    forget();
    const into = await openDeck({ slides: 2 });
    const view = render(<Workspace session={into.session} ui={into.ui} />);
    const stage = view.container.querySelector<HTMLElement>(".ks-stage")!;
    const count = into.session.slide.elements.length;
    fireEvent.paste(stage, { clipboardData: data });
    expect(into.session.slide.elements).toHaveLength(count + 2);
    // Only the HTML and the words came through.
    const standard = transfer({ "text/html": data.data.get("text/html")!, "text/plain": data.data.get("text/plain")! });
    fireEvent.paste(stage, { clipboardData: standard });
    expect(into.session.slide.elements).toHaveLength(count + 4);
  });

  it("makes a text box of plain words, in the middle of the slide, and of the words of HTML from another program", async () => {
    const made = await open();
    const { session } = made;
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "Just some words" }) });
    const [one] = session.state.selection as [string];
    expect(made.at(one).type).toBe("text");
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/html": "<h1>A heading</h1><p>and a <b>paragraph</b></p>" }) });
    const [two] = session.state.selection as [string];
    const box = made.at(two);
    expect(box.type === "text" && box.text.paragraphs.map((p) => p.runs.map((r) => r.t).join(""))).toEqual(["A heading", "and a paragraph"]);
  });

  it("puts words where the pointer was over the slide, and in the middle when it was not", async () => {
    const made = await open();
    act(() => made.ui.setZoom(1));
    const page = made.view.container.querySelector<HTMLElement>(".ks-page")!;
    // Over the slide at 600, 300 (the page has no layout under jsdom: the window's place is the slide's).
    fireEvent.pointerMove(page, { clientX: 600, clientY: 300 });
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "Here" }) });
    const [here] = made.session.state.selection as [string];
    expect(made.at(here).x! + made.at(here).w! / 2).toBeCloseTo(600, -1);
    expect(made.at(here).y! + made.at(here).h! / 2).toBeCloseTo(300, -1);
    fireEvent.pointerLeave(page);
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "There" }) });
    const [there] = made.session.state.selection as [string];
    expect(made.at(there).x! + made.at(there).w! / 2).toBeCloseTo(made.session.deck.size.w / 2, -1);
  });

  it("makes a picture of an image on the clipboard, kept with the host as a pasted picture", async () => {
    const made = await open();
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])], "image.png", { type: "image/png" });
    const seen: unknown[] = [];
    const add = made.host.addImage.bind(made.host);
    made.host.addImage = async (name, bytes, options) => {
      seen.push([name, options]);
      return add(name, bytes, options);
    };
    await act(async () => void fireEvent.paste(made.stage(), { clipboardData: transfer({}, [png]) }));
    await act(async () => {});
    expect(seen).toHaveLength(1);
    expect((seen[0] as [string, unknown])[0]).toMatch(/^Pasted image /);
    expect(made.session.slide.elements.filter((e) => e.type === "image")).toHaveLength(1);
  });

  it("leaves the event alone in a field or in the text box being written", async () => {
    const made = await open();
    const field = made.view.container.querySelector<HTMLElement>("textarea")!;
    const data = transfer({ "text/plain": "typed words" });
    expect(fireEvent.paste(field, { clipboardData: data })).toBe(true);
    expect(made.session.slide.elements).toHaveLength(2);
  });
});

describe("what lets the keys make the events", () => {
  // Chromium makes a copy, cut or paste event for a key only when the page says it may: by cancelling the "before" event.
  const asked = (target: HTMLElement, type: string): boolean => !target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

  it("says yes to a copy or cut where there is something selected, and always to a paste", async () => {
    const made = await open();
    expect(asked(made.stage(), "beforecopy")).toBe(false);
    expect(asked(made.stage(), "beforecut")).toBe(false);
    expect(asked(made.stage(), "beforepaste")).toBe(true);
    act(() => made.session.select([made.a]));
    expect(asked(made.stage(), "beforecopy")).toBe(true);
    expect(asked(made.stage(), "beforecut")).toBe(true);
  });

  it("says yes for the slides of the list, which always has one shown", async () => {
    const made = await open();
    expect(asked(made.list(), "beforecopy")).toBe(true);
  });

  it("says nothing in a field, which has its own", async () => {
    const made = await open();
    act(() => made.session.select([made.a]));
    const field = made.view.container.querySelector<HTMLElement>("textarea")!;
    expect(asked(field, "beforecopy")).toBe(false);
    expect(asked(field, "beforepaste")).toBe(false);
  });
});

describe("the slides", () => {
  it("are copied from the filmstrip, and pasted after the slide shown from the slide or the filmstrip", async () => {
    const made = await open(4);
    const { session } = made;
    const ids = idsOf(session);
    act(() => session.selectSlides([ids[0]!, ids[1]!]));
    made.list().focus();
    const data = transfer();
    expect(fireEvent.copy(made.list(), { clipboardData: data })).toBe(false);
    expect(JSON.parse(data.data.get(KASTEN_TYPE)!)).toMatchObject({ kind: "slides" });
    // The words of a copy of slides are their titles.
    expect(data.data.get("text/plain")).toMatch(/Talk|Slide 1/);
    act(() => session.selectSlides([ids[2]!]));
    fireEvent.paste(made.list(), { clipboardData: data });
    expect(session.deck.slides).toHaveLength(ids.length + 2);
    const now = idsOf(session);
    expect(now.slice(0, 3)).toEqual(ids.slice(0, 3));
    expect(session.state.slideSelection).toEqual(now.slice(3, 5));
  });

  it("are cut from the filmstrip, one step of undo, and pasted from the slide too", async () => {
    const made = await open(4);
    const { session } = made;
    const ids = idsOf(session);
    act(() => session.selectSlides([ids[1]!]));
    made.list().focus();
    const data = transfer();
    fireEvent.cut(made.list(), { clipboardData: data });
    expect(session.deck.slides).toHaveLength(ids.length - 1);
    fireEvent.paste(made.stage(), { clipboardData: data });
    expect(session.deck.slides).toHaveLength(ids.length);
    act(() => session.undo());
    expect(session.deck.slides).toHaveLength(ids.length - 1);
  });

  it("are copied from the grid", async () => {
    const made = await open(3);
    act(() => made.ui.setView("grid"));
    const grid = screen.getByRole("listbox", { name: "Slides" });
    grid.focus();
    const data = transfer();
    expect(fireEvent.copy(grid, { clipboardData: data })).toBe(false);
    expect(JSON.parse(data.data.get(KASTEN_TYPE)!)).toMatchObject({ kind: "slides" });
  });
});
