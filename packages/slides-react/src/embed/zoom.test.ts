// Ctrl plus, minus and zero and the wheel: they zoom the page of the selected embed, are saved on it, and are the slide's own zoom only
// when no embed is selected.

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { COMMANDS, dispatchKey, isEnabled, runCommand } from "../editor/commands/index.ts";
import type { CommandContext } from "../editor/commands/types.ts";
import { shape } from "../editor/factory.ts";
import type { SlidesHost } from "../editor/host.ts";
import { EditorSession } from "../editor/session/session.ts";
import { EditorUi } from "../editor/ui-state.ts";
import { newDeck } from "../test/engine.ts";
import { selectedEmbed, setEmbedZoom, zoomSelectedEmbed } from "./zoom.ts";
import { zoomKeyOf, zoomWheelOf } from "./zoom-keys.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };

async function open(extra: Record<string, unknown> = {}) {
  const session = new EditorSession(await newDeck("Zoom"), host, { saveDelay: 60_000 });
  session.slides.add({ layout: "blank" });
  const [id] = session.elements.insert([{ type: "embed", id: "", url: "https://example.com", x: 40, y: 40, w: 320, h: 200, ...extra } as unknown as Element]) as [string];
  const ui = new EditorUi();
  const context: CommandContext = { session, ui };
  return { session, ui, context, id };
}

const zoomOf = (session: EditorSession, id: string) => (session.elements.find([id])[0] as Extract<Element, { type: "embed" }>).zoom;
const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

describe("what the keys and the wheel mean", () => {
  it("are plus, minus and zero with Ctrl or Cmd, and the wheel turned with Ctrl", () => {
    const base = { ctrlKey: true, metaKey: false, altKey: false };
    expect(zoomKeyOf({ ...base, key: "=" })).toBe("in");
    expect(zoomKeyOf({ ...base, key: "+" })).toBe("in");
    expect(zoomKeyOf({ ...base, key: "-" })).toBe("out");
    expect(zoomKeyOf({ ...base, key: "0" })).toBe("fit");
    expect(zoomKeyOf({ ...base, key: "x", code: "NumpadAdd" })).toBe("in");
    expect(zoomKeyOf({ ...base, key: "=", ctrlKey: false })).toBeNull();
    expect(zoomKeyOf({ ...base, key: "=", altKey: true })).toBeNull();
    expect(zoomWheelOf({ ctrlKey: true, metaKey: false, deltaY: -100 })).toBe("in");
    expect(zoomWheelOf({ ctrlKey: true, metaKey: false, deltaY: 100 })).toBe("out");
    expect(zoomWheelOf({ ctrlKey: false, metaKey: false, deltaY: 100 })).toBeNull();
  });
});

describe("the zoom of the selected embed", () => {
  it("is only for a single embed that is selected", async () => {
    const { session, id } = await open();
    session.select([]);
    expect(selectedEmbed(session)).toBeNull();
    session.select([id]);
    expect(selectedEmbed(session)?.element.id).toBe(id);
    const [other] = session.elements.insert([shape("rect", { x: 0, y: 0, w: 20, h: 20 })]) as [string];
    session.select([id, other]);
    expect(selectedEmbed(session)).toBeNull();
    expect(zoomSelectedEmbed(session, "in")).toBe(false);
  });

  it("steps through the sizes a browser steps through, from the scale the page is at now, and Fit takes the zoom away", async () => {
    const { session, id } = await open();
    session.select([id]);
    // Fit at Desktop width in a box 320 wide is 25%: the next size up is 33%.
    expect(zoomSelectedEmbed(session, "in")).toBe(true);
    expect(zoomOf(session, id)).toBe(0.33);
    zoomSelectedEmbed(session, "in");
    expect(zoomOf(session, id)).toBe(0.5);
    zoomSelectedEmbed(session, "out");
    expect(zoomOf(session, id)).toBe(0.33);
    zoomSelectedEmbed(session, "fit");
    expect(zoomOf(session, id) ?? null).toBeNull();
  });

  it("keeps within 25% and 300%", async () => {
    const { session, id } = await open();
    session.select([id]);
    setEmbedZoom(session, id, 0.25);
    zoomSelectedEmbed(session, "out");
    expect(zoomOf(session, id)).toBe(0.25);
    setEmbedZoom(session, id, 3);
    zoomSelectedEmbed(session, "in");
    expect(zoomOf(session, id)).toBe(3);
  });

  it("makes a burst of steps one step of undo", async () => {
    const { session, id } = await open();
    session.select([id]);
    zoomSelectedEmbed(session, "in");
    zoomSelectedEmbed(session, "in");
    zoomSelectedEmbed(session, "in");
    expect(zoomOf(session, id)).toBe(0.67);
    session.undo();
    expect(zoomOf(session, id) ?? null).toBeNull();
  });

  it("does nothing to an embed that is locked", async () => {
    const { session, id } = await open({ locked: true });
    session.select([id]);
    expect(zoomSelectedEmbed(session, "in")).toBe(false);
    expect(zoomOf(session, id) ?? null).toBeNull();
  });
});

describe("the keys, where the slide has them", () => {
  it("zoom the page of a selected embed and not the slide", async () => {
    const { session, ui, context, id } = await open();
    session.select([id]);
    ui.setZoom("fit");
    expect(isEnabled(COMMANDS.get("embed.zoom-in")!, context)).toBe(true);
    expect(dispatchKey(press({ key: "=", ctrlKey: true }), context, "stage")).toBe(true);
    expect(zoomOf(session, id)).toBe(0.33);
    expect(ui.state.zoom).toBe("fit");
    expect(dispatchKey(press({ key: "0", ctrlKey: true }), context, "stage")).toBe(true);
    expect(zoomOf(session, id) ?? null).toBeNull();
    expect(ui.state.zoom).toBe("fit");
  });

  it("are the slide's own zoom when nothing but the slide is selected", async () => {
    const { session, ui, context } = await open();
    session.select([]);
    expect(isEnabled(COMMANDS.get("embed.zoom-in")!, context)).toBe(false);
    ui.setZoom(1);
    expect(dispatchKey(press({ key: "=", ctrlKey: true }), context, "stage")).toBe(true);
    expect(ui.state.zoom).toBeGreaterThan(1);
  });

  it("are not taken while words are being written", async () => {
    const { session, ui, context, id } = await open();
    session.select([id]);
    ui.setZoom(1);
    // In a text box a chord with Ctrl is still the slide's (the page's zoom is for a selected box that is not being typed in).
    dispatchKey(press({ key: "=", ctrlKey: true }), context, "text");
    expect(zoomOf(session, id) ?? null).toBeNull();
  });

  it("can be run from a menu as well", async () => {
    const { session, context, id } = await open();
    session.select([id]);
    await runCommand("embed.zoom-in", context);
    expect(zoomOf(session, id)).toBe(0.33);
  });
});
