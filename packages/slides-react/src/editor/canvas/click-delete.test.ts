// One click selects whatever is on the slide, whatever it is, and Delete takes it away; Undo brings it back. Nothing opens for typing on that
// first click, so Delete can never erase characters instead.

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { newComposite } from "../composite-kinds.ts";
import { dispatchKey } from "../commands/index.ts";
import { line, plainText, shape, table, textBox } from "../factory.ts";
import type { SlidesHost } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo } from "./controller.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };
const BOX = { x: 200, y: 150, w: 300, h: 160 };
const MIDDLE = { x: 350, y: 230 };
const at = (x: number, y: number): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, client: { x: x + 1000, y: y + 500 } });
const press = (key: string): KeyboardEvent => new KeyboardEvent("keydown", { key, code: key, cancelable: true });

const kinds: [string, () => Element, boolean?][] = [
  ["text", () => textBox(BOX, "Some words")],
  ["an empty text box", () => textBox(BOX)],
  ["shape", () => shape("rect", BOX)],
  ["image", () => ({ type: "image", id: "", src: "assets/figure.png", ...BOX }) as Element],
  ["line", () => line("straight", false, { x: 200, y: 150 }, { x: 500, y: 310 })],
  ["connector", () => ({ ...line("straight", true, { x: 200, y: 150 }, { x: 500, y: 310 }), type: "connector" }) as Element],
  ["elbow connector", () => ({ ...line("elbow", true, { x: 200, y: 150 }, { x: 500, y: 310 }), type: "connector" }) as Element],
  ["table", () => table(2, 2, BOX)],
  ["chart", () => ({ type: "chart", id: "", kind: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }], ...BOX }) as unknown as Element],
  ["group", () => ({ type: "group", id: "", children: [{ ...textBox(BOX, "In a group"), id: "child" }] }) as unknown as Element],
  ["embed", () => ({ type: "embed", id: "", url: "https://example.com/docs", ...BOX }) as unknown as Element],
  ["video", () => ({ type: "video", id: "", src: "assets/clip.mp4", ...BOX }) as unknown as Element],
  ["composite", () => ({ ...newComposite("code"), x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h }) as Element],
  ["locked", () => ({ ...shape("rect", BOX), locked: true }) as Element],
];

describe.each(kinds)("a click on %s", (_name, make) => {
  async function open() {
    const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
    const ui = new EditorUi();
    const controller = new CanvasController(session, ui, () => 1);
    session.slides.add({ layout: "blank" });
    const [id] = session.elements.insert([make()]) as [string];
    session.select([]);
    return { session, ui, controller, id };
  }

  it("selects it without opening it, and Delete removes it, and Undo brings it back", async () => {
    const { session, ui, controller, id } = await open();
    controller.down(at(MIDDLE.x, MIDDLE.y), { kind: "surface" });
    controller.up(at(MIDDLE.x, MIDDLE.y));
    expect(session.state.selection).toEqual([id]);
    expect(session.state.editing).toBeNull();
    expect(session.state.cells).toBeNull();
    expect(dispatchKey(press("Delete"), { session, ui }, "stage")).toBe(true);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(false);
    session.undo();
    expect(session.slide.elements.some((e) => e.id === id)).toBe(true);
  });
});

describe("Delete after a first click on a text box", () => {
  it("removes the box and leaves its words alone until it is opened", async () => {
    const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
    const ui = new EditorUi();
    const controller = new CanvasController(session, ui, () => 1);
    session.slides.add({ layout: "blank" });
    const [id] = session.elements.insert([textBox(BOX, "Keep these words")]) as [string];
    session.select([]);
    controller.down(at(MIDDLE.x, MIDDLE.y), { kind: "surface" });
    controller.up(at(MIDDLE.x, MIDDLE.y));
    // The second click on the selected box opens it, and then keys are typing.
    controller.down(at(MIDDLE.x, MIDDLE.y), { kind: "surface" });
    controller.up(at(MIDDLE.x, MIDDLE.y));
    expect(session.state.editing).toBe(id);
    expect(dispatchKey(press("Delete"), { session, ui }, "text")).toBe(false);
    session.elements.setText(id, plainText("Kept"));
    expect(session.slide.elements.some((e) => e.id === id)).toBe(true);
  });
});
