import { describe, expect, it } from "vitest";

import { pointerOf } from "../canvas/pointer.ts";
import { COMMANDS, dispatchKey, keysOf, runCommand } from "../commands/index.ts";
import type { CommandContext } from "../commands/types.ts";
import { shape, textBox } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { newDeck } from "../../test/engine.ts";

const press = (key: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent => new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, cancelable: true, ...extra });

async function open(snap = false) {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  if (!snap) ui.toggleSnap();
  ui.setZoom(1);
  session.slides.add({ layout: "blank" });
  const context: CommandContext = { session, ui };
  // The window and the slide are the same thing here: the page is at the window's top left, drawn at full size.
  pointerOf(ui).attach((x, y) => (x >= 0 && y >= 0 && x <= 960 && y <= 540 ? { x, y } : null));
  const at = (x: number, y: number) => pointerOf(ui).moved(x, y);
  const elements = () => session.slide.elements;
  return { session, ui, context, at, elements };
}

describe("T adds a text box at once", () => {
  it("puts it at the pointer, selects it and opens it for typing", async () => {
    const { session, context, at, elements } = await open();
    at(200, 120);
    const key = press("t");
    expect(dispatchKey(key, context, "stage")).toBe(true);
    expect(key.defaultPrevented).toBe(true);
    const made = elements().at(-1)!;
    expect(made).toMatchObject({ type: "text", x: 200, y: 120, w: 300, h: 56 });
    expect(session.state.selection).toEqual([made.id]);
    expect(session.state.editing).toBe(made.id);
    expect(session.state.tool).toBe("select");
  });

  it("is one step of undo to make it", async () => {
    const { session, context, at, elements } = await open();
    at(200, 120);
    const before = elements().length;
    dispatchKey(press("t"), context, "stage");
    expect(elements()).toHaveLength(before + 1);
    expect(session.state.undoLabel).toBe("add_elements");
    session.undo();
    expect(elements()).toHaveLength(before);
  });

  it("is held inside the slide", async () => {
    const { context, at, elements } = await open();
    at(950, 535);
    dispatchKey(press("t"), context, "stage");
    expect(elements().at(-1)).toMatchObject({ x: 660, y: 484 });
  });

  it("snaps to the others when snapping is on, and not when it is off", async () => {
    for (const [snap, x] of [
      [true, 500],
      [false, 497],
    ] as const) {
      const { session, context, at, elements } = await open(snap);
      session.elements.insert([shape("rect", { x: 500, y: 300, w: 120, h: 120 })]);
      session.select([]);
      at(497, 100);
      dispatchKey(press("t"), context, "stage");
      expect(elements().at(-1), `snap ${snap}`).toMatchObject({ type: "text", x, y: 100 });
    }
  });

  it("goes to a free place near the top left third when the pointer is not over the slide", async () => {
    const { context, elements, at } = await open();
    dispatchKey(press("t"), context, "stage");
    expect(elements().at(-1)).toMatchObject({ x: 96, y: 90, w: 300, h: 56 });
    // Off the slide (but in the window) is the same as nowhere.
    at(-30, 700);
    context.session.stopEditing();
    dispatchKey(press("t"), context, "stage");
    expect(elements()).toHaveLength(2);
    expect(elements().at(-1)).toMatchObject({ type: "text" });
    // The second is not on top of the first.
    const [first, second] = elements();
    expect([second?.x, second?.y]).not.toEqual([first?.x, first?.y]);
  });

  it("goes to where the pointer last was on the slide once it has gone off it (to a menu, the filmstrip), snapped and held inside as at the pointer", async () => {
    const { session, context, at, elements, ui } = await open(true);
    session.elements.insert([shape("rect", { x: 500, y: 300, w: 120, h: 120 })]);
    session.select([]);
    at(497, 100);
    pointerOf(ui).left();
    expect(pointerOf(ui).slidePoint()).toBeNull();
    dispatchKey(press("t"), context, "stage");
    expect(elements().at(-1)).toMatchObject({ type: "text", x: 500, y: 100 });
    context.session.stopEditing();
    at(955, 539);
    pointerOf(ui).left();
    dispatchKey(press("t"), context, "stage");
    expect(elements().at(-1)).toMatchObject({ x: 660, y: 484 });
  });

  it("keeps clear of what the slide already has", async () => {
    const { session, context, elements } = await open();
    session.elements.insert([textBox({ x: 48, y: 40, w: 864, h: 360 }, "Body")]);
    dispatchKey(press("t"), context, "stage");
    const made = elements().at(-1)!;
    expect(made.y).toBeGreaterThanOrEqual(400 - 8);
  });
});

describe("R and O add a shape at once", () => {
  it("puts a rectangle at the pointer at its usual size, selected and not open for typing", async () => {
    const { session, context, at, elements } = await open();
    at(300, 200);
    expect(dispatchKey(press("r"), context, "stage")).toBe(true);
    const made = elements().at(-1)!;
    expect(made).toMatchObject({ type: "shape", shape: "rect", x: 300, y: 200, w: 160, h: 120 });
    expect(session.state.selection).toEqual([made.id]);
    expect(session.state.editing).toBeNull();
  });

  it("puts an oval where the pointer is, and both go to a free place when it is not over the slide", async () => {
    const { context, at, elements } = await open();
    at(600, 150);
    dispatchKey(press("o"), context, "stage");
    expect(elements().at(-1)).toMatchObject({ type: "shape", shape: "ellipse", x: 600, y: 150, w: 160, h: 120 });
    at(-1, -1);
    dispatchKey(press("r"), context, "stage");
    expect(elements().at(-1)).toMatchObject({ shape: "rect", x: 96, y: 90 });
  });

  it("adds one for a key press and not one for each repeat of a key held down", async () => {
    const { context, at, elements } = await open();
    at(300, 200);
    expect(dispatchKey(press("r"), context, "stage")).toBe(true);
    expect(dispatchKey(press("r", { repeat: true }), context, "stage")).toBe(true);
    expect(dispatchKey(press("r", { repeat: true }), context, "stage")).toBe(true);
    expect(elements()).toHaveLength(1);
  });
});

describe("L, A and I", () => {
  it("arm the line and the arrow, which need two points", async () => {
    const { session, context } = await open();
    expect(dispatchKey(press("l"), context, "stage")).toBe(true);
    expect(session.state.tool).toBe("line:straight");
    expect(dispatchKey(press("a"), context, "stage")).toBe(true);
    expect(session.state.tool).toBe("arrow:straight");
    expect(session.slide.elements).toHaveLength(0);
  });

  it("opens and closes the images drawer", async () => {
    const { ui, context } = await open();
    expect(dispatchKey(press("i"), context, "stage")).toBe(true);
    expect(ui.state.galleryOpen).toBe(true);
    dispatchKey(press("i"), context, "stage");
    expect(ui.state.galleryOpen).toBe(false);
  });
});

describe("where the keys work", () => {
  it("only when the slide itself has the keys: not in a text box, a field, the filmstrip, a toolbar button or a panel", async () => {
    const { session, ui, context, at } = await open();
    at(200, 120);
    for (const area of ["text", "field", "filmstrip", "canvas"] as const) {
      for (const key of ["t", "r", "o", "l", "a", "i"]) {
        const event = press(key);
        expect(dispatchKey(event, context, area), `${key} in ${area}`).toBe(false);
        expect(event.defaultPrevented, `${key} in ${area}`).toBe(false);
      }
    }
    expect(session.slide.elements).toHaveLength(0);
    expect(session.state.tool).toBe("select");
    expect(ui.state.galleryOpen).toBe(false);
  });

  it("with no other key held: Ctrl, Cmd, Alt and Shift chords are not theirs", async () => {
    const { session, context, at } = await open();
    at(200, 120);
    for (const key of ["t", "r", "o", "l", "a", "i"]) {
      for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
        const event = press(key, held);
        // Mod+A is Select all and Mod+I is nothing here; whatever they are, they are not these keys' doing.
        dispatchKey(event, context, "stage");
      }
    }
    expect(session.slide.elements.filter((e) => e.type === "text" || e.type === "shape" || e.type === "line")).toHaveLength(0);
    expect(session.state.tool).toBe("select");
    expect(session.state.editing).toBeNull();
  });

  it("does not take the keys the slide already had", async () => {
    const { session, context } = await open();
    const [box] = session.elements.insert([textBox({ x: 10, y: 10, w: 100, h: 40 }, "Words")]) as [string];
    expect(dispatchKey(press("Delete", { code: "Delete" }), context, "stage")).toBe(true);
    expect(session.slide.elements.some((e) => e.id === box)).toBe(false);
    session.elements.insert([textBox({ x: 10, y: 10, w: 100, h: 40 }, "Words")]);
    expect(dispatchKey(press("a", { ctrlKey: true }), context, "stage")).toBe(true);
    expect(session.state.selection).toHaveLength(1);
  });
});

describe("the toolbar's button and the menu's item", () => {
  it("still arm the tool, to place the box with a click or a drag, and show the key", async () => {
    const { session, context, elements } = await open();
    await runCommand("insert.text-box", context);
    expect(session.state.tool).toBe("text");
    expect(elements()).toHaveLength(0);
    await runCommand("insert.shape.rect", context);
    expect(session.state.tool).toBe("shape:rect");
    await runCommand("insert.shape.ellipse", context);
    expect(session.state.tool).toBe("shape:ellipse");
    expect(elements()).toHaveLength(0);
    expect(keysOf("insert.text-box")).toBe("T");
    expect(keysOf("insert.shape.rect")).toBe("R");
    expect(keysOf("insert.shape.ellipse")).toBe("O");
    expect(keysOf("insert.line.straight")).toBe("L");
    expect(keysOf("insert.arrow.straight")).toBe("A");
    expect(keysOf("insert.gallery")).toBe("I");
  });

  it("are the only commands with these letters, each once", () => {
    const bound = [...COMMANDS.values()].filter((c) => c.keys?.some((k) => /^[A-Z]$/.test(k)));
    expect(bound.map((c) => [c.id, c.keys, c.scope])).toEqual([
      ["insert.text-box", ["T"], "stage"],
      ["insert.gallery", ["I"], "stage"],
      ["insert.shape.rect", ["R"], "stage"],
      ["insert.shape.ellipse", ["O"], "stage"],
      ["insert.line.straight", ["L"], "stage"],
      ["insert.arrow.straight", ["A"], "stage"],
    ]);
  });
});
