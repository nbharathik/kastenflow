// A click on a text box is a click to write in it, with the caret where the pointer was; a shape opens on a double click.

import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape, textBox } from "../factory.ts";
import type { SlidesHost } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo } from "./controller.ts";
import { typeIntoSelection } from "./type-in.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };
const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, client: { x: x + 1000, y: y + 500 }, ...extra });

async function setup() {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const ui = new EditorUi();
  const controller = new CanvasController(session, ui, () => 1);
  session.slides.add({ layout: "blank" });
  const [words, box, other] = session.elements.insert([
    textBox({ x: 100, y: 100, w: 300, h: 80 }, "Hello brave world"),
    shape("rect", { x: 500, y: 100, w: 200, h: 100 }),
    textBox({ x: 100, y: 300, w: 300, h: 80 }, "Another box"),
  ]) as [string, string, string];
  session.select([]);
  const click = (x: number, y: number, extra: Partial<PointerInfo> = {}) => {
    controller.down(at(x, y, extra), { kind: "surface" });
    controller.up(at(x, y, extra));
  };
  return { session, controller, words, box, other, click };
}

describe("a click on a text box", () => {
  it("only selects it the first time, so Delete removes the box and not its words", async () => {
    const { session, words, click } = await setup();
    click(150, 130);
    expect(session.state.selection).toEqual([words]);
    expect(session.state.editing).toBeNull();
  });

  it("opens it for writing on the next click, with the caret where the pointer was", async () => {
    const { session, words, click } = await setup();
    click(150, 130);
    click(160, 135);
    expect(session.state.selection).toEqual([words]);
    expect(session.state.editing).toBe(words);
    expect(session.state.editFrom).toEqual({ at: { x: 1160, y: 635 } });
  });

  it("opens the box without a place for the caret where the host gave none", async () => {
    const { session, words, controller, click } = await setup();
    click(150, 130);
    controller.down({ ...at(150, 130), client: undefined as never }, { kind: "surface" });
    controller.up({ ...at(150, 130), client: undefined as never });
    expect(session.state.editing).toBe(words);
    expect(session.state.editFrom).toBeNull();
  });

  it("closes the box that was open, and only selects the one clicked", async () => {
    const { session, words, other, click } = await setup();
    click(150, 130);
    click(150, 130);
    expect(session.state.editing).toBe(words);
    click(150, 330);
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([other]);
  });

  it("does not open for a drag, which moves the box, selected or not", async () => {
    const { session, words, controller } = await setup();
    controller.down(at(150, 130), { kind: "surface" });
    controller.move(at(190, 160));
    controller.up(at(190, 160));
    expect(session.state.editing).toBeNull();
    expect(session.slide.elements.find((e) => e.id === words)).toMatchObject({ x: 140, y: 130 });
    // Selected now: the body of the box moves it again, and it still does not open.
    controller.down(at(190, 160), { kind: "surface" });
    controller.move(at(210, 160));
    controller.up(at(210, 160));
    expect(session.state.editing).toBeNull();
    expect(session.slide.elements.find((e) => e.id === words)).toMatchObject({ x: 160, y: 130 });
  });

  it("opens on a double click even when it was not selected", async () => {
    const { session, words, controller } = await setup();
    controller.down(at(150, 130, { detail: 1 }), { kind: "surface" });
    controller.up(at(150, 130, { detail: 1 }));
    controller.down(at(150, 130, { detail: 2 }), { kind: "surface" });
    controller.up(at(150, 130, { detail: 2 }));
    controller.doubleClick(at(150, 130, { detail: 2 }));
    expect(session.state.editing).toBe(words);
    expect(session.state.editFrom).toEqual({ at: { x: 1150, y: 630 }, select: "word" });
  });

  it("is opened by a character typed with it selected, which goes in as the last character", async () => {
    const { session, words, click } = await setup();
    click(150, 130);
    expect(typeIntoSelection(session, { key: "Q", ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(session.state.editing).toBe(words);
    const held = session.slide.elements.find((e) => e.id === words);
    expect(held?.type === "text" && held.text.paragraphs[0]?.runs.map((r) => r.t).join("")).toBe("Hello brave worldQ");
  });

  it("is not opened by a chord, Space, a tool in hand, several selected, a shape or a locked box", async () => {
    const { session, words, box, other, click } = await setup();
    click(150, 130);
    const key = (k: string, extra: object = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra });
    expect(typeIntoSelection(session, key("b", { ctrlKey: true }))).toBe(false);
    expect(typeIntoSelection(session, key(" "))).toBe(false);
    expect(typeIntoSelection(session, key("Enter"))).toBe(false);
    session.select([words, other]);
    expect(typeIntoSelection(session, key("a"))).toBe(false);
    session.select([box]);
    expect(typeIntoSelection(session, key("a"))).toBe(false);
    session.select([words]);
    session.elements.lock(true, [words]);
    expect(typeIntoSelection(session, key("a"))).toBe(false);
    expect(session.state.editing).toBeNull();
  });

  it("does not open for a click with Shift, Ctrl or Alt, which take it into the selection or copy it", async () => {
    const { session, click } = await setup();
    click(150, 130, { shift: true });
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toHaveLength(1);
    click(150, 330, { mod: true });
    expect(session.state.editing).toBeNull();
    click(150, 330, { alt: true });
    expect(session.state.editing).toBeNull();
  });

  it("does not open when it picks one of several selected: that is a click to choose, and the next one writes", async () => {
    const { session, words, other, click } = await setup();
    session.select([words, other]);
    click(150, 130);
    expect(session.state.selection).toEqual([words]);
    expect(session.state.editing).toBeNull();
    click(150, 130);
    expect(session.state.editing).toBe(words);
  });

  it("selects a text box that is locked, without opening it or moving it", async () => {
    const { session, words, controller, click } = await setup();
    session.elements.lock(true, [words]);
    click(150, 130);
    expect(session.state.selection).toEqual([words]);
    click(150, 130);
    expect(session.state.editing).toBeNull();
    controller.down(at(150, 130), { kind: "surface" });
    controller.move(at(250, 230));
    controller.up(at(250, 230));
    expect(session.slide.elements.find((e) => e.id === words)).toMatchObject({ x: 100, y: 100 });
  });

  it("does not open on a click that is the end of the move handle's press", async () => {
    const { session, words, controller } = await setup();
    session.select([words]);
    controller.down(at(80, 80), { kind: "move", id: null });
    controller.up(at(80, 80));
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([words]);
  });
});

describe("a click on a shape", () => {
  it("only selects it", async () => {
    const { session, box, click } = await setup();
    click(600, 150);
    expect(session.state.selection).toEqual([box]);
    expect(session.state.editing).toBeNull();
  });
});

describe("a double click", () => {
  it("opens a shape with the word under the pointer taken", async () => {
    const { session, box, controller } = await setup();
    controller.doubleClick(at(600, 150, { detail: 2 }));
    expect(session.state.editing).toBe(box);
    expect(session.state.editFrom).toEqual({ at: { x: 1600, y: 650 }, select: "word" });
  });
});

describe("Escape", () => {
  it("is for the edit first, keeping the box selected; the next one is for the selection", async () => {
    const { session, words, click } = await setup();
    click(150, 130);
    session.stopEditing();
    expect(session.state.editing).toBeNull();
    expect(session.state.editFrom).toBeNull();
    expect(session.state.selection).toEqual([words]);
  });
});
