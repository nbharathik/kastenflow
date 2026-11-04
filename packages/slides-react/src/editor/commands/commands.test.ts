import { describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import type { SlidesHost } from "../host.ts";
import { shape, textBox } from "../factory.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { ICONS } from "../ui/icons.ts";
import { COMMANDS, comboOf, dispatchKey, isEnabled, keysOf, runCommand } from "./index.ts";
import type { CommandContext } from "./types.ts";

const host: SlidesHost = {
  save: async () => ({ status: "saved" }),
  imageUrl: () => undefined,
  addImage: async (name) => `assets/${name}`,
  deliver: async () => {},
};

async function context(): Promise<CommandContext> {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 10_000 });
  return { session, ui: new EditorUi() };
}

const press = (key: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", { key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, cancelable: true, ...extra });

describe("the command list", () => {
  it("has unique ids, real icons and no two commands on one key in one scope", () => {
    const seen = new Map<string, string>();
    for (const command of COMMANDS.values()) {
      if (command.icon) expect(ICONS, command.id).toHaveProperty(command.icon);
      for (const combo of command.keys ?? []) {
        const key = `${command.scope ?? "global"} ${combo}`;
        expect(seen.get(key), `${key} is bound to ${seen.get(key)} and ${command.id}`).toBeUndefined();
        seen.set(key, command.id);
      }
    }
    expect(COMMANDS.size).toBeGreaterThan(80);
  });

  it("shows the first key of a command as it reads on this system", () => {
    expect(keysOf("text.bold")).toMatch(/^(Ctrl\+B|⌘B)$/);
    expect(keysOf("view.full-screen")).toMatch(/^(Ctrl\+Alt\+F|⌘⌥F)$/);
    // Ctrl+Shift+F is KastenFlow's own search, so the editor's full screen leaves it alone.
    expect(keysOf("view.full-screen")).not.toMatch(/Shift/);
    expect(keysOf("insert.text-box")).toBe("T");
    expect(keysOf("insert.shape.triangle")).toBeUndefined();
    expect(() => keysOf("nope")).toThrow("No editor command");
  });
});

describe("key combinations", () => {
  it("names a press the way commands do", () => {
    expect(comboOf(press("b", { ctrlKey: true }), false)).toBe("Mod+B");
    expect(comboOf(press("b", { metaKey: true }), true)).toBe("Mod+B");
    expect(comboOf(press("z", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+Z");
    expect(comboOf(press("ArrowUp", { ctrlKey: true, altKey: true }), false)).toBe("Mod+Alt+Up");
    // The square brackets are named by their keys: with Option held, a Mac types other characters on them.
    expect(comboOf(new KeyboardEvent("keydown", { key: "‘", code: "BracketRight", altKey: true }), true)).toBe("Alt+]");
    expect(comboOf(new KeyboardEvent("keydown", { key: "{", code: "BracketLeft", altKey: true, shiftKey: true }), false)).toBe("Alt+Shift+[");
    expect(comboOf(press("Delete"), false)).toBe("Delete");
    expect(comboOf(press("8", { ctrlKey: true, shiftKey: true, code: "Digit8" }), false)).toBe("Mod+Shift+8");
    // A metaKey press on a PC is not Mod.
    expect(comboOf(press("b", { metaKey: true }), false)).toBe("Ctrl+B");
  });
});

describe("commands", () => {
  it("adds a slide, and undoes and redoes it, only when it can", async () => {
    const c = await context();
    expect(isEnabled(COMMANDS.get("edit.undo")!, c)).toBe(false);
    await runCommand("slide.new", c);
    expect(c.session.deck.slides).toHaveLength(2);
    expect(isEnabled(COMMANDS.get("edit.undo")!, c)).toBe(true);
    await runCommand("edit.undo", c);
    expect(c.session.deck.slides).toHaveLength(1);
    await runCommand("edit.redo", c);
    expect(c.session.deck.slides).toHaveLength(2);
    await runCommand("edit.redo", c);
    expect(c.session.deck.slides).toHaveLength(2);
  });

  it("enables arranging only when the selection allows it", async () => {
    const c = await context();
    const [a, b, d] = c.session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 }), shape("rect", { x: 100, y: 10, w: 50, h: 50 }), textBox({ x: 200, y: 10, w: 50, h: 50 }, "x")]) as [string, string, string];
    c.session.select([a]);
    expect(isEnabled(COMMANDS.get("arrange.group")!, c)).toBe(false);
    expect(isEnabled(COMMANDS.get("arrange.front")!, c)).toBe(true);
    c.session.select([a, b]);
    await runCommand("arrange.group", c);
    expect(c.session.slide.elements.some((e) => e.type === "group")).toBe(true);
    expect(isEnabled(COMMANDS.get("arrange.ungroup")!, c)).toBe(true);
    c.session.select([d]);
    expect(isEnabled(COMMANDS.get("arrange.ungroup")!, c)).toBe(false);
    expect(isEnabled(COMMANDS.get("arrange.distribute-horizontal")!, c)).toBe(false);
  });

  it("checks the toggles from the state", async () => {
    const c = await context();
    const skip = COMMANDS.get("slide.skip")!;
    expect(skip.checked?.(c.session.state, c.ui.state)).toBe(false);
    await runCommand("slide.skip", c);
    expect(skip.checked?.(c.session.state, c.ui.state)).toBe(true);
    await runCommand("view.notes", c);
    expect(c.ui.state.notesOpen).toBe(false);
    await runCommand("view.zoom-in", c);
    expect(c.ui.state.zoom).toBe(1.25);
    await runCommand("view.zoom-fit", c);
    expect(c.ui.state.zoom).toBe("fit");
  });

  it("formats the words of a selected box when no text is being edited", async () => {
    const c = await context();
    const [a] = c.session.elements.insert([textBox({ x: 10, y: 300, w: 300, h: 50 }, "Words")]) as [string];
    await runCommand("text.bold", c);
    expect(c.session.text.state([a]).bold).toBe(true);
    await runCommand("text.align-center", c);
    expect(c.session.text.state([a]).align).toBe("center");
    await runCommand("text.bullets", c);
    expect(c.session.text.state([a]).list).toBe("bullet");
  });

  it("sends formatting to the open text editor instead", async () => {
    const c = await context();
    const calls: string[] = [];
    const handle = new Proxy({} as never, { get: (_, name) => (...args: unknown[]) => void calls.push(`${String(name)}(${args.join(",")})`) });
    c.ui.setText(handle);
    await runCommand("text.italic", c);
    await runCommand("text.numbers", c);
    expect(calls).toEqual(["toggleItalic()", "toggleList(number)"]);
  });
});

describe("keys", () => {
  it("runs the command a key stands for where it applies", async () => {
    const c = await context();
    const [a] = c.session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]) as [string];
    // On the slide, Delete deletes the selection.
    const del = press("Delete");
    expect(dispatchKey(del, c, "canvas")).toBe(true);
    expect(del.defaultPrevented).toBe(true);
    expect(c.session.slide.elements.some((e) => e.id === a)).toBe(false);
    // In a text box, it is typing.
    expect(dispatchKey(press("Delete"), c, "text")).toBe(false);
    // In the filmstrip the same key deletes slides, not elements.
    c.session.slides.add();
    expect(c.session.deck.slides).toHaveLength(2);
    expect(dispatchKey(press("Delete"), c, "filmstrip")).toBe(true);
    expect(c.session.deck.slides).toHaveLength(1);
  });

  it("lets modified global keys through in a text box", async () => {
    const c = await context();
    const bold = vi.fn();
    c.ui.setText(new Proxy({} as never, { get: (_, name) => (name === "toggleBold" ? bold : () => {}) }));
    expect(dispatchKey(press("b", { ctrlKey: true }), c, "text")).toBe(true);
    expect(bold).toHaveBeenCalledOnce();
    // Mod+A selects all elements on the slide, but in a text box it is the editor's.
    expect(dispatchKey(press("a", { ctrlKey: true }), c, "text")).toBe(false);
    expect(dispatchKey(press("q", { ctrlKey: true }), c, "canvas")).toBe(false);
  });

  it("lets a chord made for fields work in a field, and no other key", async () => {
    const c = await context();
    const chord = { ctrlKey: true, altKey: true };
    expect(dispatchKey(press("F", chord), c, "field")).toBe(true);
    expect(c.ui.state.fullScreen).toBe(true);
    // Undo, select all and the rest belong to the field, and a plain F is typing.
    c.session.slides.add();
    expect(dispatchKey(press("z", { ctrlKey: true }), c, "field")).toBe(false);
    expect(dispatchKey(press("a", { ctrlKey: true }), c, "field")).toBe(false);
    expect(dispatchKey(press("F"), c, "field")).toBe(false);
    expect(c.session.deck.slides).toHaveLength(2);
    // In a text box the same chord runs, as every global chord does.
    expect(dispatchKey(press("F", chord), c, "text")).toBe(true);
    expect(c.ui.state.fullScreen).toBe(false);
  });
});
