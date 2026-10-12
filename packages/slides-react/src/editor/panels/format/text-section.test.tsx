import type { Element, Paragraph, Text } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PLAIN_FORMAT } from "../../../text/handle.ts";
import { shape, textBox } from "../../factory.ts";
import type { FormatState } from "../../session/text-commands.ts";
import type { TextHandle } from "../../text-handle.ts";
import { edit, enter, hasSection, held, mount, section } from "./test-kit.tsx";

afterEach(cleanup);

const p = (words: string, extra: Partial<Paragraph> = {}): Paragraph => ({ runs: [{ t: words }], ...extra });
const box = { x: 100, y: 100, w: 300, h: 160 };
const words = (...paragraphs: Paragraph[]): Element => ({ ...textBox(box), text: { paragraphs } }) as Element;
const textOf = (kit: Awaited<ReturnType<typeof mount>>, id: string): Text => {
  const e = held(kit, id);
  return (e.type === "text" ? e.text : e.type === "shape" ? e.text : undefined) as Text;
};
const checked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked") === "true";
const field = (name: string) => within(section("text")).getByLabelText(name) as HTMLInputElement;

describe("Text: paragraphs", () => {
  it("sets the alignment of every paragraph and leaves the words alone", async () => {
    const kit = await mount({ elements: [words({ runs: [{ t: "Bold ", b: true }, { t: "plain" }], align: "left" }, p("Second", { align: "center" }))] });
    const [id] = kit.ids as [string];
    // The two paragraphs differ: nothing is picked.
    expect(["Align left", "Align centre", "Align right", "Justify"].some(checked)).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Align right" }));
    expect(textOf(kit, id).paragraphs.map((q) => q.align)).toEqual(["right", "right"]);
    expect(textOf(kit, id).paragraphs[0]?.runs).toEqual([{ t: "Bold ", b: true }, { t: "plain" }]);
    expect(checked("Align right")).toBe(true);
    expect(kit.errors).toEqual([]);
  });

  it("shows the alignment the theme gives a paragraph that names none", async () => {
    const kit = await mount({ elements: [words(p("Nothing said", { style: "caption" }))] });
    expect(checked("Align left")).toBe(true);
    // The theme's caption style is now centred: so is the paragraph, though it says nothing itself.
    edit(() => kit.engine.apply("edit_theme", { patch: { textStyles: { caption: { align: "center" } } } }));
    expect(checked("Align centre")).toBe(true);
    expect(checked("Align left")).toBe(false);
  });

  it("chooses the line spacing, and puts the theme's back with Default", async () => {
    const kit = await mount({ elements: [words(p("One"), p("Two", { lineSpacing: 2 }))] });
    const [id] = kit.ids as [string];
    const spacing = screen.getByLabelText("Line spacing") as HTMLSelectElement;
    expect(spacing.value).toBe("mixed");
    fireEvent.change(spacing, { target: { value: "1.5" } });
    expect(textOf(kit, id).paragraphs.map((q) => q.lineSpacing)).toEqual([1.5, 1.5]);
    expect((screen.getByLabelText("Line spacing") as HTMLSelectElement).value).toBe("1.5");
    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "default" } });
    expect(textOf(kit, id).paragraphs.map((q) => q.lineSpacing)).toEqual([undefined, undefined]);
  });

  it("lists a spacing that is not among the usual ones", async () => {
    await mount({ elements: [words(p("One", { lineSpacing: 1.3 }))] });
    const spacing = screen.getByLabelText("Line spacing") as HTMLSelectElement;
    expect(spacing.value).toBe("1.3");
    expect([...spacing.options].map((o) => o.value)).toEqual(["default", "1", "1.15", "1.3", "1.5", "2"]);
  });

  it("sets the space before and after, in points, as one step", async () => {
    const kit = await mount({ elements: [words({ runs: [{ t: "One", i: true }] }, p("Two"))] });
    const [id] = kit.ids as [string];
    const before = kit.session.state.revision;
    enter(field("Space before"), "12");
    enter(field("Space after"), "6.5");
    expect(textOf(kit, id).paragraphs.map((q) => [q.spaceBefore, q.spaceAfter])).toEqual([[12, 6.5], [12, 6.5]]);
    expect(textOf(kit, id).paragraphs[0]?.runs).toEqual([{ t: "One", i: true }]);
    expect(kit.session.state.revision).toBe(before + 2);
    edit(() => kit.session.undo());
    expect(field("Space after").value).toBe("");
    expect(field("Space before").value).toBe("12");
  });

  it("shows mixed spacing across paragraphs and boxes, and sets it on all", async () => {
    const kit = await mount({ elements: [words(p("One", { spaceBefore: 4 })), words(p("Two", { spaceBefore: 9 }))] });
    const [a, b] = kit.ids as [string, string];
    expect(field("Space before").value).toBe("");
    expect(field("Space before").placeholder).toBe("—");
    enter(field("Space before"), "0");
    expect([a, b].map((id) => textOf(kit, id).paragraphs[0]?.spaceBefore)).toEqual([0, 0]);
  });
});

describe("Text: lists", () => {
  it("makes every paragraph a bulleted or numbered list, or plain again", async () => {
    const kit = await mount({ elements: [words(p("One"), p("Two"))] });
    const [id] = kit.ids as [string];
    expect(checked("No list")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Bulleted list" }));
    expect(textOf(kit, id).paragraphs.map((q) => [q.list, q.level])).toEqual([["bullet", 0], ["bullet", 0]]);
    expect(checked("Bulleted list")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Numbered list" }));
    expect(textOf(kit, id).paragraphs.map((q) => q.list)).toEqual(["number", "number"]);
    fireEvent.click(screen.getByRole("radio", { name: "No list" }));
    expect(textOf(kit, id).paragraphs.map((q) => [q.list, q.level])).toEqual([[undefined, undefined], [undefined, undefined]]);
  });

  it("shows mixed when only some are listed, and No list clears them all in one step", async () => {
    const kit = await mount({ elements: [words(p("One", { list: "bullet", level: 1 }), p("Two"))] });
    const [id] = kit.ids as [string];
    expect(["No list", "Bulleted list", "Numbered list"].some(checked)).toBe(false);
    const before = kit.session.state.revision;
    fireEvent.click(screen.getByRole("radio", { name: "No list" }));
    expect(textOf(kit, id).paragraphs.map((q) => q.list)).toEqual([undefined, undefined]);
    expect(kit.session.state.revision).toBe(before + 1);
  });

  it("indents and outdents", async () => {
    const kit = await mount({ elements: [words(p("One", { list: "bullet", level: 0 }))] });
    const [id] = kit.ids as [string];
    fireEvent.click(screen.getByRole("button", { name: "Increase indent" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase indent" }));
    expect(textOf(kit, id).paragraphs[0]?.level).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Decrease indent" }));
    expect(textOf(kit, id).paragraphs[0]?.level).toBe(1);
  });
});

describe("Text: the box", () => {
  it("sets where the words sit vertically, showing the place a box gives them when none is said", async () => {
    const kit = await mount({ elements: [words(p("One")), shape("rect", { x: 400, y: 100, w: 100, h: 100 })], select: [0] });
    const [a, b] = kit.ids as [string, string];
    expect(checked("Align top")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Align bottom" }));
    expect(textOf(kit, a).valign).toBe("bottom");
    expect(textOf(kit, a).paragraphs).toEqual([p("One")]);
    edit(() => kit.session.select([b]));
    expect(checked("Align middle")).toBe(true);
    edit(() => kit.session.select([a, b]));
    expect(["Align top", "Align middle", "Align bottom"].some(checked)).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Align top" }));
    expect([a, b].map((id) => textOf(kit, id).valign)).toEqual(["top", "top"]);
  });

  it("shows and sets the space around the words, four numbers", async () => {
    const kit = await mount({ elements: [words(p("One"))] });
    const [id] = kit.ids as [string];
    expect([field("Inset left").value, field("Inset top").value, field("Inset right").value, field("Inset bottom").value]).toEqual(["9.6", "4.8", "9.6", "4.8"]);
    enter(field("Inset left"), "20");
    expect(textOf(kit, id).insets).toEqual({ left: 20, top: 4.8, right: 9.6, bottom: 4.8 });
    enter(field("Inset bottom"), "0");
    expect(textOf(kit, id).insets).toEqual({ left: 20, top: 4.8, right: 9.6, bottom: 0 });
    expect(kit.errors).toEqual([]);
  });

  it("shows mixed insets", async () => {
    const kit = await mount({ elements: [words(p("One")), { ...words(p("Two")), text: { paragraphs: [p("Two")], insets: { left: 1, top: 1, right: 1, bottom: 1 } } } as Element] });
    const [a, b] = kit.ids as [string, string];
    expect(field("Inset left").value).toBe("");
    expect(field("Inset left").placeholder).toBe("—");
    enter(field("Inset left"), "5");
    expect(textOf(kit, a).insets).toEqual({ left: 5, top: 4.8, right: 9.6, bottom: 4.8 });
    expect(textOf(kit, b).insets).toEqual({ left: 5, top: 1, right: 1, bottom: 1 });
  });
});

describe("Text: which elements", () => {
  it("is there for text boxes and shapes that hold text, not for other things", async () => {
    await mount({ elements: [words(p("One"))] });
    expect(hasSection("text")).toBe(true);
    cleanup();
    await mount({ elements: [shape("ellipse", box)] });
    expect(hasSection("text")).toBe(true);
    cleanup();
    await mount({ elements: [{ type: "shape", id: "", shape: "rect", ...box } as Element] });
    expect(hasSection("text")).toBe(false);
    cleanup();
    await mount({ elements: [{ type: "image", id: "", src: "assets/x.png", ...box } as Element] });
    expect(hasSection("text")).toBe(false);
  });

  it("changes only the boxes that have words when the selection has other things", async () => {
    const kit = await mount({ elements: [words(p("One")), { type: "image", id: "", src: "assets/x.png", x: 500, y: 100, w: 100, h: 100 } as Element] });
    fireEvent.click(screen.getByRole("radio", { name: "Align centre" }));
    expect(textOf(kit, kit.ids[0] as string).paragraphs[0]?.align).toBe("center");
    expect(kit.errors).toEqual([]);
  });
});

/** The parts of an open text editor the panel talks to. */
function fakeEditor(state: Partial<FormatState> = {}): TextHandle & { calls: string[] } {
  const calls: string[] = [];
  const note =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map(String).join(",")})`);
    };
  const format: FormatState = { ...PLAIN_FORMAT, ...state };
  return {
    calls,
    focus: vi.fn(),
    getText: vi.fn(),
    selectAll: vi.fn(),
    formatState: () => format,
    toggleBold: note("bold"),
    toggleItalic: note("italic"),
    toggleUnderline: note("underline"),
    toggleStrike: note("strike"),
    toggleCode: note("code"),
    setColor: note("color"),
    setSize: note("size"),
    stepSize: note("stepSize"),
    setFont: note("font"),
    setAlign: note("align"),
    toggleList: note("list"),
    indent: note("indent"),
    setLineSpacing: note("spacing"),
    setLink: note("link"),
    clearFormatting: note("clear"),
    insertText: note("insert"),
  } as unknown as TextHandle & { calls: string[] };
}

describe("Text: while a text box is open", () => {
  it("sends alignment, lists, indents and spacing to the editor, for the words selected in it", async () => {
    const kit = await mount({ elements: [words(p("One"))] });
    const [id] = kit.ids as [string];
    const editor = fakeEditor({ align: "center", list: "bullet", lineSpacing: 1.5 });
    edit(() => kit.ui.setText(editor));
    // What is shown is how the selected words are.
    expect(checked("Align centre")).toBe(true);
    expect(checked("Bulleted list")).toBe(true);
    expect((screen.getByLabelText("Line spacing") as HTMLSelectElement).value).toBe("1.5");

    fireEvent.click(screen.getByRole("radio", { name: "Align right" }));
    fireEvent.click(screen.getByRole("radio", { name: "Numbered list" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase indent" }));
    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "2" } });
    expect(editor.calls).toEqual(["align(right)", "list(number)", "indent(1)", "spacing(2)"]);
    // The deck is not touched: the editor writes its words when it is done.
    expect(textOf(kit, id).paragraphs).toEqual([p("One")]);
  });

  it("takes a list off with the same button that put it on", async () => {
    const kit = await mount({ elements: [words(p("One"))] });
    const editor = fakeEditor({ list: "number" });
    edit(() => kit.ui.setText(editor));
    fireEvent.click(screen.getByRole("radio", { name: "No list" }));
    expect(editor.calls).toEqual(["list(number)"]);
  });
});
