import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { chromeOf } from "../chrome/chrome.ts";
import { COMPOSITES, COMPOSITE_TYPES, INSERTABLE, newComposite } from "../composite-kinds.ts";
import { textBox } from "../factory.ts";
import { insertComposite } from "../insert-composite.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { SAMPLE_QR_ADDRESS } from "./composites.ts";
import { COMMANDS, dispatchKey, isEnabled, keysOf, runCommand } from "./index.ts";
import type { CommandContext } from "./types.ts";

async function context(layout = "blank"): Promise<CommandContext & { errors: string[] }> {
  const errors: string[] = [];
  const session = new EditorSession(await newDeck("Composites"), new MemoryHost(), { saveDelay: 60_000, onError: (message) => errors.push(message) });
  session.slides.add({ layout });
  return { session, ui: new EditorUi(), errors };
}

const press = (key: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent => new KeyboardEvent("keydown", { key, code: key === "/" ? "Slash" : `Key${key.toUpperCase()}`, cancelable: true, ...extra });
const composites = (c: CommandContext): Element[] => c.session.slide.elements.filter((e) => COMPOSITE_TYPES.includes(e.type as never));

describe("the kinds of composite", () => {
  it("are the twelve the format has, all of which the editor can make: each has a command, a name and a size that fits the slide", () => {
    expect(COMPOSITES.map((c) => c.kind)).toEqual(COMPOSITE_TYPES);
    expect(COMPOSITES).toHaveLength(12);
    expect(INSERTABLE).toHaveLength(12);
    for (const spec of COMPOSITES) {
      expect(spec.size.w).toBeLessThanOrEqual(960);
      expect(spec.size.h).toBeLessThanOrEqual(540);
    }
    for (const spec of INSERTABLE) expect(COMMANDS.get(`insert.${spec.kind}`)?.label, spec.kind).toBe(spec.label);
  });

  it("offer a chart, a timer and a QR code, each by a command of its own", () => {
    for (const kind of ["chart", "timer", "qr"]) {
      expect(INSERTABLE.map((c) => c.kind)).toContain(kind);
      expect(COMMANDS.has(`insert.${kind}`), kind).toBe(true);
    }
    expect(["insert.chart.line", "insert.chart.pie", "insert.emoji"].every((id) => COMMANDS.has(id))).toBe(true);
    expect(newComposite("chart").type).toBe("chart");
    expect(newComposite("timer").type).toBe("timer");
    expect(newComposite("qr", { address: "https://example.com" })).toMatchObject({ type: "qr", data: "https://example.com" });
  });

  it("start with something to look at: six lines of dark Python, a formula, three messages, five next tokens, three cards", () => {
    const code = newComposite("code") as Extract<Element, { type: "code" }>;
    expect(code.language).toBe("python");
    expect(code.theme).toBe("dark");
    expect(code.code.split("\n")).toHaveLength(6);
    expect((newComposite("math") as Extract<Element, { type: "math" }>).latex).toBe("E = mc^2");
    const chat = newComposite("chat") as Extract<Element, { type: "chat" }>;
    expect(chat.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    const probs = newComposite("token-probs") as Extract<Element, { type: "token-probs" }>;
    expect(probs.tokens.join("")).toBe("The cat sat on the");
    expect(probs.next).toHaveLength(5);
    expect(probs.chosen).toBe(0);
    expect((newComposite("card-grid") as Extract<Element, { type: "card-grid" }>).cards).toHaveLength(3);
    expect((newComposite("citation") as Extract<Element, { type: "citation" }>).keys).toEqual([]);
    expect(newComposite("step-label").type).toBe("step-label");
  });

  it("make an embedded page from an address and a title, and a video from an address", () => {
    expect(newComposite("embed", { address: "https://example.com", title: "Docs" })).toMatchObject({ type: "embed", url: "https://example.com", title: "Docs" });
    expect(newComposite("embed", { address: "https://example.com" })).not.toHaveProperty("title");
    expect(newComposite("video", { address: "assets/clip.mp4" })).toMatchObject({ type: "video", src: "assets/clip.mp4" });
  });
});

describe("inserting a composite", () => {
  it.each(["code", "math", "chat", "token-probs", "card-grid", "step-label"] as const)("puts a %s on the slide, selected, and is one step of undo", async (kind) => {
    const c = await context();
    await runCommand(`insert.${kind}`, c);
    const [made] = composites(c);
    expect(made?.type).toBe(kind);
    expect(c.session.state.selection).toEqual([made?.id]);
    expect(c.session.state.tool).toBe("select");
    expect(c.errors).toEqual([]);
    // Whole, inside the slide.
    expect(made?.x).toBeGreaterThanOrEqual(0);
    expect(made?.y).toBeGreaterThanOrEqual(0);
    expect((made?.x ?? 0) + (made?.w ?? 0)).toBeLessThanOrEqual(960);
    expect((made?.y ?? 0) + (made?.h ?? 0)).toBeLessThanOrEqual(540);
    c.session.undo();
    expect(composites(c)).toHaveLength(0);
    c.session.redo();
    expect(composites(c)).toHaveLength(1);
  });

  it("puts a chart, a timer and a QR code on the slide, each one step of undo", async () => {
    for (const [id, type] of [["insert.chart", "chart"], ["insert.timer", "timer"], ["insert.qr", "qr"]] as const) {
      const c = await context();
      await runCommand(id, c);
      expect(composites(c).map((e) => e.type)).toEqual([type]);
      expect(c.session.state.selection).toEqual([composites(c)[0]?.id]);
      expect(c.errors).toEqual([]);
      c.session.undo();
      expect(composites(c)).toHaveLength(0);
    }
  });

  it("makes a line chart and a pie chart from their own commands, with data to look at", async () => {
    const c = await context();
    await runCommand("insert.chart", c);
    await runCommand("insert.chart.line", c);
    await runCommand("insert.chart.pie", c);
    const charts = composites(c) as Extract<Element, { type: "chart" }>[];
    expect(charts.map((e) => e.kind)).toEqual(["bar", "line", "pie"]);
    for (const chart of charts) {
      expect(chart.categories.length).toBeGreaterThan(1);
      for (const series of chart.series) expect(series.values).toHaveLength(chart.categories.length);
    }
    // No colours are fixed: the theme's accents are used in turn, so a new theme recolours the chart.
    expect(charts[0]?.series.every((s) => !s.color)).toBe(true);
  });

  it("starts a QR code from the web address the slide links to, and from an example when it links to none", async () => {
    const empty = await context();
    await runCommand("insert.qr", empty);
    expect(composites(empty)[0]).toMatchObject({ type: "qr", data: SAMPLE_QR_ADDRESS });
    const linked = await context();
    linked.session.elements.insert([{ ...textBox({ x: 40, y: 40, w: 200, h: 40 }, "Docs"), link: "https://example.org/docs" } as Element]);
    await runCommand("insert.qr", linked);
    expect(composites(linked)[0]).toMatchObject({ type: "qr", data: "https://example.org/docs" });
  });

  it("opens the emoji picker from its command", async () => {
    const c = await context();
    await runCommand("insert.emoji", c);
    expect(c.ui.state.dialog).toBe("emoji");
    expect(composites(c)).toHaveLength(0);
  });

  it("asks which works to cite, in a dialog of its own, instead of putting an empty citation on the slide", async () => {
    const c = await context();
    await runCommand("insert.citation", c);
    expect(c.ui.state.dialog).toBe("citation");
    expect(composites(c)).toHaveLength(0);
    const other = await context();
    await runCommand("insert.code", other);
    expect(other.ui.state.panel).toBeNull();
  });

  it("asks for an address, for a page or a video, instead of guessing one", async () => {
    const c = await context();
    await runCommand("insert.embed", c);
    expect(c.ui.state.dialog).toBe("embed");
    await runCommand("insert.video", c);
    expect(c.ui.state.dialog).toBe("video");
    expect(composites(c)).toHaveLength(0);
  });

  it("puts each new one on top of what is there", async () => {
    const c = await context();
    await runCommand("insert.math", c);
    await runCommand("insert.code", c);
    expect(c.session.slide.elements.map((e) => e.type)).toEqual(["math", "code"]);
  });

  it("goes below the title that is there, not on top of it", async () => {
    const c = await context("title-only");
    const title = c.session.slide.elements.find((e) => e.placeholder === "title");
    const box = c.session.elements.boxOf(title as Element);
    // The title has words, so it is something to keep clear of.
    c.session.elements.setText(title!.id, { paragraphs: [{ runs: [{ t: "A title" }] }] });
    await runCommand("insert.code", c);
    const [made] = composites(c);
    expect(box).not.toBeNull();
    expect(made?.y).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.h ?? 0));
  });

  it("does not put a new one on top of another where there is room beside it", async () => {
    const c = await context();
    c.session.elements.insert([textBox({ x: 48, y: 40, w: 300, h: 460 }, "A column of words")]);
    await runCommand("insert.chat", c);
    const [made] = composites(c);
    expect(made?.x).toBeGreaterThanOrEqual(348);
  });

  it("puts a step label at the bottom right and a citation at the bottom left, where they belong", async () => {
    const c = await context();
    await runCommand("insert.step-label", c);
    insertComposite(c.session, "citation");
    const [label, cite] = composites(c);
    expect([label?.x, label?.y]).toEqual([712, 484]);
    expect([cite?.x, cite?.y]).toEqual([64, 484]);
  });

  it("puts them elsewhere when the corner has something in it", async () => {
    const c = await context();
    c.session.elements.insert([textBox({ x: 700, y: 480, w: 240, h: 50 }, "A footer")]);
    await runCommand("insert.step-label", c);
    const [, label] = c.session.slide.elements;
    expect([label?.x, label?.y]).not.toEqual([712, 484]);
  });

  it("is one step of undo also when the palette or a menu is the way in", async () => {
    const c = await context();
    const before = c.session.state.undoLabel;
    await runCommand("insert.card-grid", c);
    expect(c.session.state.undoLabel).not.toBe(before);
    c.session.undo();
    expect(c.session.state.undoLabel).toBe(before);
  });
});

describe("the command palette's keys", () => {
  it("are Ctrl+Shift+P and Ctrl+K for all of it, Alt+/ for its commands, Ctrl+/ and the slash for what to insert", async () => {
    expect(COMMANDS.get("view.palette")?.keys).toEqual(["Mod+Shift+P"]);
    expect(COMMANDS.get("view.palette-k")?.keys).toEqual(["Mod+K"]);
    expect(COMMANDS.get("view.menu-search")?.keys).toEqual(["Alt+/"]);
    expect(COMMANDS.get("insert.palette")?.keys).toEqual(["Mod+/", "/"]);
    expect(keysOf("insert.palette")).toMatch(/^(Ctrl\+\/|⌘\/)$/);
    // The keyboard shortcuts are one Shift away.
    expect(COMMANDS.get("help.shortcuts")?.keys).toEqual(["Mod+Shift+?", "Mod+Shift+/"]);
  });

  it("open it from the slide, from the filmstrip, and with Ctrl+Shift+P from a text box", async () => {
    const c = await context();
    expect(dispatchKey(press("/"), c, "canvas")).toBe(true);
    expect(c.ui.state.dialog).toBe("insert");
    c.ui.openDialog(null);
    expect(dispatchKey(press("/"), c, "filmstrip")).toBe(true);
    c.ui.openDialog(null);
    expect(dispatchKey(press("p", { ctrlKey: true, shiftKey: true }), c, "text")).toBe(true);
    expect(c.ui.state.dialog).toBe("insert");
  });

  it("ask the palette to start on the part each key is for", async () => {
    const c = await context();
    expect(dispatchKey(press("/", { altKey: true }), c, "canvas")).toBe(true);
    expect(chromeOf(c.ui).takePalette()).toBe("commands");
    c.ui.openDialog(null);
    expect(dispatchKey(press("/"), c, "canvas")).toBe(true);
    expect(chromeOf(c.ui).takePalette()).toBe("insert");
    c.ui.openDialog(null);
    expect(dispatchKey(press("p", { ctrlKey: true, shiftKey: true }), c, "canvas")).toBe(true);
    expect(chromeOf(c.ui).takePalette()).toBe("all");
  });

  it("give Ctrl+K to the palette, except where it is Insert link: a text box open, or something selected", async () => {
    const c = await context();
    // Nothing selected, no text open: the palette.
    c.session.select([]);
    expect(dispatchKey(press("k", { ctrlKey: true }), c, "canvas")).toBe(true);
    expect(c.ui.state.dialog).toBe("insert");
    c.ui.openDialog(null);
    // A box selected: the link, as before.
    const [id] = c.session.elements.insert([textBox({ x: 40, y: 40, w: 300, h: 60 }, "Words")]) as [string];
    c.session.select([id]);
    expect(dispatchKey(press("k", { ctrlKey: true }), c, "canvas")).toBe(true);
    expect(c.ui.state.dialog).toBe("link");
    c.ui.openDialog(null);
    // Ctrl+Shift+P is the palette's whatever is selected.
    expect(dispatchKey(press("p", { ctrlKey: true, shiftKey: true }), c, "canvas")).toBe(true);
    expect(c.ui.state.dialog).toBe("insert");
  });

  it("leave the slash alone while a text box is typed in", async () => {
    const c = await context();
    const event = press("/");
    expect(dispatchKey(event, c, "text")).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(c.ui.state.dialog).toBeNull();
  });
});

describe("Ungroup to shapes", () => {
  const add = (c: CommandContext, ...elements: object[]): string[] => c.session.elements.insert(elements as Element[]);
  const code = { type: "code", id: "", language: "python", code: "print(1)", x: 64, y: 148, w: 600, h: 260 };
  const formula = { type: "math", id: "", latex: "x^2", x: 64, y: 40, w: 300, h: 90 };

  it("is enabled for a code block, and not for text or a formula", async () => {
    const c = await context();
    const [a, t, m] = add(c, code, textBox({ x: 700, y: 10, w: 100, h: 40 }, "words"), formula) as [string, string, string];
    const ungroup = COMMANDS.get("arrange.ungroup-composite")!;
    c.session.select([t]);
    expect(isEnabled(ungroup, c)).toBe(false);
    c.session.select([m]);
    expect(isEnabled(ungroup, c)).toBe(false);
    c.session.select([a]);
    expect(isEnabled(ungroup, c)).toBe(true);
    c.session.select([t, a]);
    expect(isEnabled(ungroup, c)).toBe(true);
    c.session.select([]);
    expect(isEnabled(ungroup, c)).toBe(false);
  });

  it("puts a group of shapes where the composite was, selects it, and is one step of undo", async () => {
    const c = await context();
    const [below, a, above] = add(c, textBox({ x: 700, y: 10, w: 100, h: 40 }, "below"), code, textBox({ x: 700, y: 60, w: 100, h: 40 }, "above")) as [string, string, string];
    c.session.select([a]);
    await runCommand("arrange.ungroup-composite", c);
    expect(c.errors).toEqual([]);
    const order = c.session.slide.elements.map((e) => e.id);
    expect(order).toEqual([below, a, above]);
    const group = c.session.slide.elements[1];
    expect(group?.type).toBe("group");
    expect(group?.type === "group" && group.children.length).toBeGreaterThan(0);
    expect(group?.type === "group" && group.children.every((child) => !COMPOSITE_TYPES.includes(child.type as never))).toBe(true);
    expect(c.session.state.selection).toEqual([a]);
    c.session.undo();
    expect(c.session.slide.elements[1]?.type).toBe("code");
    c.session.redo();
    expect(c.session.slide.elements[1]?.type).toBe("group");
  });

  it("does all the selected composites as one step, and leaves a formula and other things as they are", async () => {
    const c = await context();
    const ids = add(c, code, { ...code, y: 20, h: 100 }, formula, textBox({ x: 700, y: 10, w: 100, h: 40 }, "words"));
    c.session.select(ids);
    await runCommand("arrange.ungroup-composite", c);
    expect(c.session.slide.elements.map((e) => e.type)).toEqual(["group", "group", "math", "text"]);
    expect(c.session.state.selection).toEqual([ids[0], ids[1]]);
    c.session.undo();
    expect(c.session.slide.elements.map((e) => e.type)).toEqual(["code", "code", "math", "text"]);
  });

  it("does nothing when nothing that can be ungrouped is selected", async () => {
    const c = await context();
    const [m] = add(c, formula) as [string];
    c.session.select([m]);
    const before = c.session.state.undoLabel;
    await runCommand("arrange.ungroup-composite", c);
    expect(c.session.state.undoLabel).toBe(before);
    expect(c.session.slide.elements[0]?.type).toBe("math");
  });
});
