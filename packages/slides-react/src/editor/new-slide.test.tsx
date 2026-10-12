// What New slide makes: a blank slide until the person says otherwise, however it is asked for (the menu, Mod+M, the button under the
// filmstrip, a double click on its empty space), with a choice of layout beside the button and a setting that is kept in this browser.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DeckEngine } from "@kasten-slides/wasm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newDeck } from "../test/engine.ts";
import { COMMANDS, dispatchKey, runCommand } from "./commands/index.ts";
import { Filmstrip } from "./filmstrip/Filmstrip.tsx";
import { openDeck } from "./filmstrip/test-support.ts";
import { MemoryHost } from "./memory-host.ts";
import { MenuBar } from "./menus/MenuBar.tsx";
import { bar, click, openEditor, row } from "./menus/testing.ts";
import { addSlide } from "./new-slide.ts";
import { EditorSession } from "./session/session.ts";
import { BLANK, blankLayoutOf } from "./session/slides.ts";
import { NEW_SLIDES_KEY } from "./ui-prefs.ts";
import { EditorUi } from "./ui-state.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const layoutOf = (session: EditorSession, id: string | undefined) => session.deck.slides.find((slide) => slide.id === id)?.layout;
const elementsOf = (session: EditorSession, id: string | undefined) => session.deck.slides.find((slide) => slide.id === id)?.elements ?? [];

describe("a slide added without a layout", () => {
  it("is blank: no boxes to fill, none to delete", async () => {
    const { session } = await openEditor();
    const made = session.slides.add();
    expect(layoutOf(session, made)).toBe(BLANK);
    expect(elementsOf(session, made)).toEqual([]);
    expect(session.state.slideId).toBe(made);
  });

  it("is blank after a slide of any layout, and the layouts it is given are still used", async () => {
    const { session } = await openEditor();
    const body = session.slides.add({ layout: "title-body" });
    expect(layoutOf(session, session.slides.add()), "after title and body").toBe(BLANK);
    expect(elementsOf(session, body).length).toBeGreaterThan(0);
    expect(layoutOf(session, session.slides.add({ layout: "two-columns" }))).toBe("two-columns");
  });

  it("copies the layout of the slide shown when asked to, and has a title and body after an opening slide", async () => {
    const { session } = await openEditor();
    expect(layoutOf(session, session.slides.add({ likeCurrent: true })), "after the title slide").toBe("title-body");
    session.slides.add({ layout: "two-columns" });
    expect(layoutOf(session, session.slides.add({ likeCurrent: true })), "after two columns").toBe("two-columns");
  });

  it("has the layout that holds words when words are given for it", async () => {
    const { session } = await openEditor();
    const made = session.slides.add({ content: { title: "Hello" } });
    expect(layoutOf(session, made)).toBe("title-body");
    expect(session.deck.slides.find((slide) => slide.id === made)?.elements.length).toBeGreaterThan(0);
  });

  it("is one step of undo", async () => {
    const { session } = await openEditor();
    const before = session.deck.slides.length;
    session.slides.add();
    expect(session.state.undoLabel).toBe("add_slide");
    session.undo();
    expect(session.deck.slides).toHaveLength(before);
  });

  it("falls back to any layout without boxes when the theme has none called blank, and to the layout of the slide shown when it has no such layout", async () => {
    const engine = await newDeck("Talk");
    const json = JSON.parse(engine.save()) as { theme: { layouts: { name: string; placeholders: unknown[] }[] } };
    json.theme.layouts = json.theme.layouts.map((layout) => (layout.name === "blank" ? { ...layout, name: "empty" } : layout));
    const renamed = new EditorSession(DeckEngine.open(JSON.stringify(json)), new MemoryHost(), { saveDelay: 60_000 });
    expect(blankLayoutOf(renamed.deck)).toBe("empty");
    expect(layoutOf(renamed, renamed.slides.add())).toBe("empty");

    json.theme.layouts = json.theme.layouts.filter((layout) => layout.placeholders.length > 0);
    const boxes = new EditorSession(DeckEngine.open(JSON.stringify(json)), new MemoryHost(), { saveDelay: 60_000 });
    expect(blankLayoutOf(boxes.deck)).toBeUndefined();
    expect(layoutOf(boxes, boxes.slides.add())).toBe("title-body");
  });
});

describe("a new deck's second slide", () => {
  it("has no boxes, no bullet and no number, in the editor's own drawing of it", async () => {
    const made = await openDeck({ slides: 1 });
    const { session, ui } = made;
    const second = addSlide(session, ui);
    expect(session.deck.present.slideNumbers).toBe(false);
    expect(elementsOf(session, second)).toEqual([]);
    const view = render(<Filmstrip session={session} ui={ui} />);
    const thumbs = view.container.querySelectorAll(".ks-thumb .ks-slide");
    expect(thumbs).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-el="master-number"]'), "no number on either slide").toHaveLength(0);
    // Turned on in the deck's options, the number is drawn on both.
    act(() => session.slides.setSlideNumbers(true));
    expect(view.container.querySelectorAll('[data-el="master-number"]')).toHaveLength(2);
  });
});

describe("the setting", () => {
  it("is Blank to begin with, switches, and is kept for the next window in this browser", () => {
    expect(new EditorUi().state.newSlides).toBe("blank");
    const ui = new EditorUi();
    ui.setNewSlides("same");
    expect(ui.state.newSlides).toBe("same");
    expect(localStorage.getItem(NEW_SLIDES_KEY)).toBe("1");
    expect(new EditorUi().state.newSlides).toBe("same");
    ui.setNewSlides("blank");
    expect(localStorage.getItem(NEW_SLIDES_KEY)).toBe("0");
    expect(new EditorUi().state.newSlides).toBe("blank");
  });

  it("decides what addSlide makes, unless a layout is named", async () => {
    const { session, ui } = await openEditor();
    expect(layoutOf(session, addSlide(session, ui))).toBe(BLANK);
    ui.setNewSlides("same");
    expect(layoutOf(session, addSlide(session, ui, { layout: "title-only" }))).toBe("title-only");
    session.goTo(session.deck.slides[0]!.id);
    expect(layoutOf(session, addSlide(session, ui))).toBe("title-body");
  });
});

describe("New slide, the command and its key", () => {
  it("makes a blank slide, and goes by the setting", async () => {
    const { session, ui } = await openEditor();
    await runCommand("slide.new", { session, ui });
    expect(layoutOf(session, session.state.slideId)).toBe(BLANK);
    expect(session.deck.slides).toHaveLength(2);
    session.goTo(session.deck.slides[0]!.id);
    await runCommand("slide.new-same", { session, ui });
    expect(ui.state.newSlides).toBe("same");
    await runCommand("slide.new", { session, ui });
    expect(layoutOf(session, session.state.slideId)).toBe("title-body");
  });

  it("is on Mod+M, and the two settings are commands that say which is on", async () => {
    const { session, ui } = await openEditor();
    const event = new KeyboardEvent("keydown", { key: "m", code: "KeyM", ctrlKey: true, cancelable: true });
    expect(dispatchKey(event, { session, ui }, "stage")).toBe(true);
    expect(layoutOf(session, session.state.slideId)).toBe(BLANK);
    const [blank, same] = ["slide.new-blank", "slide.new-same"].map((id) => COMMANDS.get(id)!);
    expect([blank!.checked?.(session.state, ui.state), same!.checked?.(session.state, ui.state)]).toEqual([true, false]);
    await runCommand("slide.new-same", { session, ui });
    expect([blank!.checked?.(session.state, ui.state), same!.checked?.(session.state, ui.state)]).toEqual([false, true]);
    await runCommand("slide.new-blank", { session, ui });
    expect(ui.state.newSlides).toBe("blank");
  });
});

describe("View, New slides", () => {
  it("is a sub-menu with Blank and Same as current, one checked, that sets the choice", async () => {
    const { session, ui } = await openEditor();
    render(<MenuBar session={session} ui={ui} />);
    click(bar("View"));
    click(row(/^New slides/));
    expect(row("Blank").getAttribute("aria-checked")).toBe("true");
    expect(row("Same as current").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row("Same as current"));
    expect(ui.state.newSlides).toBe("same");
  });
});

describe("the button under the filmstrip", () => {
  async function strip() {
    const made = await openDeck({ slides: 2 });
    const view = render(<Filmstrip session={made.session} ui={made.ui} />);
    return { ...made, container: view.container };
  }
  const slides = (session: EditorSession) => session.deck.slides.length;

  it("adds a blank slide", async () => {
    const { session } = await strip();
    fireEvent.click(screen.getByRole("button", { name: "New slide" }));
    expect(slides(session)).toBe(3);
    expect(layoutOf(session, session.state.slideId)).toBe(BLANK);
  });

  it("adds one on the layout of the slide shown once the setting says so", async () => {
    const { session, ui } = await strip();
    act(() => ui.setNewSlides("same"));
    fireEvent.click(screen.getByRole("button", { name: "New slide" }));
    expect(layoutOf(session, session.state.slideId)).toBe("title-body");
  });

  it("adds a blank slide on a double click in the empty space under the slides", async () => {
    const { session, container } = await strip();
    fireEvent.doubleClick(container.querySelector(".ks-filmstrip")!);
    expect(slides(session)).toBe(3);
    expect(layoutOf(session, session.state.slideId)).toBe(BLANK);
  });

  it("has an arrow beside it that opens the theme's layouts as thumbnails and adds a slide on the one picked", async () => {
    const { session } = await strip();
    const arrow = screen.getByRole("button", { name: "Choose a layout for the new slide" });
    expect(arrow.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(arrow);
    const picker = screen.getByRole("listbox", { name: "Layouts" });
    const layouts = session.deck.theme.layouts.map((layout) => layout.label);
    for (const label of layouts) expect(within(picker).getByRole("option", { name: label }), label).toBeTruthy();
    expect(picker.querySelectorAll(".ks-lt .ks-slide"), "each is drawn by the renderer of the editor").toHaveLength(layouts.length);
    fireEvent.click(within(picker).getByRole("option", { name: "Two columns" }));
    expect(slides(session)).toBe(3);
    expect(layoutOf(session, session.state.slideId)).toBe("two-columns");
    expect(screen.queryByRole("listbox", { name: "Layouts" }), "the menu closes").toBeNull();
  });

  it("has the setting under the layouts, where it can be changed", async () => {
    const { session, ui } = await strip();
    fireEvent.click(screen.getByRole("button", { name: "Choose a layout for the new slide" }));
    const starts = screen.getByRole("radiogroup", { name: "New slides start" });
    const radio = (name: string) => within(starts).getByRole("radio", { name });
    expect(radio("Blank").getAttribute("aria-checked")).toBe("true");
    expect(radio("Same as current").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(radio("Same as current"));
    expect(ui.state.newSlides).toBe("same");
    expect(slides(session)).toBe(2);
    fireEvent.click(radio("My default"));
    expect(ui.state.newSlides).toBe("mine");
  });
});
