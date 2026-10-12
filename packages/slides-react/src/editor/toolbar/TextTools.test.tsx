import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { textBox } from "../factory.ts";
import { button, click, fakeTextBox, isDisabled, openEditor, row } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

// The fonts and colours used lately are kept in the browser: each test starts with none.
beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  return editor;
}

/** The runs of the first paragraph of a text box or shape. */
const runsOf = (element: Element | undefined) => {
  const text = element && (element.type === "text" || element.type === "shape") ? element.text : undefined;
  return text?.paragraphs[0]?.runs ?? [];
};
const paragraphOf = (element: Element | undefined) => (element && (element.type === "text" || element.type === "shape") ? element.text?.paragraphs[0] : undefined);

/** A text box saying "Hello world" on the slide, selected. */
async function withBox() {
  const editor = await setup();
  const [id] = editor.session.elements.insert([textBox({ x: 40, y: 40, w: 400, h: 80 }, "Hello world")]) as [string];
  const now = () => editor.session.elements.find([id])[0];
  return { ...editor, id, now };
}

describe("the text controls", () => {
  const names = ["Bold", "Italic", "Underline", "Strikethrough", "Text colour", "Insert link", "Align", "Line and paragraph spacing", "Bulleted list", "Numbered list", "Bullets and numbering", "Decrease indent", "Increase indent", "Clear formatting", "Font", "Increase font size"];

  it("are not in the bar with nothing to format, and there, and on, with a box selected", async () => {
    const { session } = await setup();
    act(() => session.select([]));
    for (const name of names) expect(screen.queryByRole("button", { name }), name).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Font size" })).toBeNull();
    act(() => {
      const [id] = session.elements.insert([textBox({ x: 40, y: 40, w: 400, h: 80 }, "Hello")]) as [string];
      session.select([id]);
    });
    for (const name of names) expect(isDisabled(button(name)), name).toBe(false);
    expect((screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("are not in the bar for a picture or a line, which have no words", async () => {
    const { session } = await setup();
    act(() => {
      const [id] = session.elements.insert([{ type: "image", id: "", src: "assets/x.png", x: 0, y: 0, w: 100, h: 100 } as Element]) as [string];
      session.select([id]);
    });
    for (const name of names) expect(screen.queryByRole("button", { name }), name).toBeNull();
  });

  it("bolds all the words of a selected box, shows it, and takes it off again", async () => {
    const { now } = await withBox();
    expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
    click(button("Bold"));
    expect(runsOf(now()).every((r) => r.b)).toBe(true);
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
    click(button("Bold"));
    expect(runsOf(now()).some((r) => r.b)).toBe(false);
    for (const [name, key] of [["Italic", "i"], ["Underline", "u"], ["Strikethrough", "s"]] as const) {
      click(button(name));
      expect(runsOf(now()).every((r) => r[key]), name).toBe(true);
      expect(button(name).getAttribute("aria-pressed"), name).toBe("true");
    }
  });

  it("shows a mark that only some of the words have as not on, and still applies it to all", async () => {
    const { session, id, now } = await withBox();
    act(() => session.elements.setText(id, { paragraphs: [{ runs: [{ t: "Hello ", b: true }, { t: "world" }] }] }));
    expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
    click(button("Bold"));
    expect(runsOf(now()).every((r) => r.b)).toBe(true);
  });

  it("counts the weight the text style gives, so the title of a slide shows Bold on", async () => {
    const { session } = await setup();
    const title = session.slide.elements.find((e) => e.placeholder === "title");
    const subtitle = session.slide.elements.find((e) => e.placeholder === "subtitle");
    expect(title && subtitle).toBeTruthy();
    act(() => session.select([title!.id]));
    // No word in it is marked bold; the title style is.
    expect(runsOf(title).some((r) => r.b)).toBe(false);
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
    act(() => session.select([subtitle!.id]));
    expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
  });

  it("steps the size along the usual sizes from the text style's own", async () => {
    const { now } = await withBox();
    const box = screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement;
    // A text box is set in the body style, 22 points.
    expect(box.value).toBe("22");
    click(button("Increase font size"));
    expect(runsOf(now()).every((r) => r.size === 24)).toBe(true);
    expect(box.value).toBe("24");
    click(button("Increase font size"));
    click(button("Increase font size"));
    expect(box.value).toBe("32");
    click(button("Decrease font size"));
    expect(runsOf(now()).every((r) => r.size === 28)).toBe(true);
  });

  it("sets the size typed in the box on Enter, and on leaving it, and puts the old one back on Escape", async () => {
    const { now } = await withBox();
    const box = screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "30" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(runsOf(now()).every((r) => r.size === 30)).toBe(true);
    fireEvent.change(box, { target: { value: "17" } });
    fireEvent.blur(box);
    expect(runsOf(now()).every((r) => r.size === 17)).toBe(true);
    fireEvent.change(box, { target: { value: "50" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("17");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(runsOf(now()).every((r) => r.size === 18)).toBe(true);
  });

  it("shows nothing in the size box where the words disagree, and steps from the text style's size", async () => {
    const { session, id, now } = await withBox();
    act(() => session.elements.setText(id, { paragraphs: [{ runs: [{ t: "Big", size: 40 }, { t: " small", size: 12 }] }] }));
    const box = screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement;
    expect(box.value).toBe("");
    expect(box.placeholder).toBe("—");
    click(button("Increase font size"));
    expect(runsOf(now()).every((r) => r.size === 24)).toBe(true);
  });

  it("picks the text colour from the palette, with Automatic putting the style's back", async () => {
    const { now } = await withBox();
    click(button("Text colour"));
    expect(within(screen.getByRole("dialog", { name: "Text colour" })).getByRole("button", { name: "Automatic" })).toBeTruthy();
    click(screen.getByRole("button", { name: "accent3" }));
    expect(runsOf(now()).every((r) => r.color === "accent3")).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Text colour" })).toBeNull();
    // The bar under the A is the colour in use.
    expect((button("Text colour").querySelector(".ks-tb-bar") as HTMLElement).style.background).toMatch(/rgb|#/);
    click(button("Text colour"));
    click(screen.getByRole("button", { name: "Automatic" }));
    expect(runsOf(now()).some((r) => r.color)).toBe(false);
  });

  it("sets the font from a list, theme fonts first, and checks the one in use", async () => {
    const { now } = await withBox();
    expect(button("Font").textContent).toBe("Inter");
    click(button("Font"));
    const list = () => screen.getByRole("listbox", { name: "Fonts" });
    const option = (name: string | RegExp) => within(list()).getByRole("option", { name });
    expect(option(/^Heading font/).textContent).toContain("Inter");
    expect(option(/^Code font/).textContent).toContain("Roboto Mono");
    expect(option(/^Body font/).getAttribute("aria-selected")).toBe("true");
    click(option("Georgia"));
    expect(runsOf(now()).every((r) => r.font === "Georgia")).toBe(true);
    expect(button("Font").textContent).toBe("Georgia");
    expect(screen.queryByRole("listbox", { name: "Fonts" })).toBeNull();
    // The font just used comes first, and the one in use is checked wherever it is listed.
    click(button("Font"));
    const [recent, listed] = within(list()).getAllByRole("option", { name: "Georgia" });
    expect(recent?.getAttribute("aria-selected")).toBe("true");
    expect(listed?.getAttribute("aria-selected")).toBe("true");
    expect(within(list()).getAllByRole("group")[0]?.getAttribute("aria-label")).toBe("Recent");
    click(option(/^Code font/));
    expect(runsOf(now()).every((r) => r.font === "code")).toBe(true);
    expect(button("Font").textContent).toBe("Roboto Mono");
  });

  it("finds a font by what is typed, takes the first with Enter, and offers a name that is not on the list", async () => {
    const { now } = await withBox();
    click(button("Font"));
    const search = screen.getByRole("combobox", { name: "Search fonts" });
    fireEvent.change(search, { target: { value: "tre" } });
    const names = within(screen.getByRole("listbox", { name: "Fonts" })).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Trebuchet MS", "Use “tre”"]);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toMatch(/custom$/);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(runsOf(now()).every((r) => r.font === "Trebuchet MS")).toBe(true);

    click(button("Font"));
    fireEvent.change(screen.getByRole("combobox", { name: "Search fonts" }), { target: { value: "Comic Neue" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search fonts" }), { key: "Enter" });
    expect(runsOf(now()).every((r) => r.font === "Comic Neue")).toBe(true);
  });

  it("offers the usual sizes under the size box, with the one in use checked", async () => {
    const { now } = await withBox();
    click(button("Font sizes"));
    // The box says 22, the text style's own, which is not one of the usual sizes: nothing is checked.
    expect(row("24").getAttribute("aria-checked")).toBe("false");
    click(row("36"));
    expect(runsOf(now()).every((r) => r.size === 36)).toBe(true);
    expect((screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement).value).toBe("36");
    click(button("Font sizes"));
    expect(row("36").getAttribute("aria-checked")).toBe("true");
  });

  it("aligns, spaces lines, and makes lists and indents", async () => {
    const { now } = await withBox();
    click(button("Align"));
    expect(row(/^Left/).getAttribute("aria-checked")).toBe("true");
    click(row(/^Centre/));
    expect(paragraphOf(now())?.align).toBe("center");
    expect(button("Align").querySelector("svg")).toBeTruthy();

    // The spacing card: the usual spacings to pick, and a way back to the text style's own.
    click(button("Line and paragraph spacing"));
    const card = screen.getByRole("dialog", { name: "Line and paragraph spacing" });
    click(within(card).getByRole("radio", { name: "Line spacing 1.5" }));
    expect(paragraphOf(now())?.lineSpacing).toBe(1.5);
    expect(within(card).getByRole("radio", { name: "Line spacing 1.5" }).getAttribute("aria-checked")).toBe("true");
    click(within(card).getByRole("button", { name: "Back to the style's own" }));
    expect(paragraphOf(now())?.lineSpacing).toBeUndefined();

    click(button("Bulleted list"));
    expect(paragraphOf(now())?.list).toBe("bullet");
    expect(button("Bulleted list").getAttribute("aria-pressed")).toBe("true");
    click(button("Numbered list"));
    expect(paragraphOf(now())?.list).toBe("number");
    click(button("Increase indent"));
    expect(paragraphOf(now())?.level).toBe(1);
    click(button("Decrease indent"));
    // Back at the first level, which a paragraph may leave unsaid.
    expect(paragraphOf(now())?.level ?? 0).toBe(0);
  });

  it("picks the look of a list from the card of bullets and numbering, which closes once one is picked", async () => {
    const { now } = await withBox();
    click(button("Bullets and numbering"));
    const card = screen.getByRole("dialog", { name: "Bullets and numbering" });
    click(within(card).getByRole("radio", { name: /^Square/ }));
    expect(paragraphOf(now())?.list).toBe("bullet");
    expect(paragraphOf(now())?.listStyle).toBe("square");
    expect(screen.queryByRole("dialog", { name: "Bullets and numbering" })).toBeNull();
    click(button("Bullets and numbering"));
    expect(within(screen.getByRole("dialog", { name: "Bullets and numbering" })).getByRole("radio", { name: /^Square/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("sets the size and colour of the markers of every item of a selected box from the card, empty items included, and takes them off", async () => {
    const { session, id, now } = await withBox();
    const all = () => (now() && now()?.type === "text" ? (now() as Extract<Element, { type: "text" }>).text.paragraphs : []);
    act(() => session.elements.setText(id, { paragraphs: [{ list: "bullet", runs: [{ t: "How are you", size: 12 }] }, { list: "bullet", runs: [{ t: "", size: 12 }] }, { runs: [{ t: "plain" }] }] }));
    click(button("Bullets and numbering"));
    const field = within(screen.getByRole("dialog", { name: "Bullets and numbering" })).getByRole("textbox", { name: "Marker size" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "150" } });
    fireEvent.keyDown(field, { key: "Enter" });
    // Both items are set, the plain paragraph is no item, and the empty one is still empty with its look.
    expect(all().map((paragraph) => paragraph.bulletSize)).toEqual([1.5, 1.5, undefined]);
    expect(all()[1]?.runs).toEqual([{ t: "", size: 12 }]);
    fireEvent.change(field, { target: { value: "900" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(all().map((paragraph) => paragraph.bulletSize)).toEqual([4, 4, undefined]);
    click(within(screen.getByRole("dialog", { name: "Bullets and numbering" })).getByRole("button", { name: "Same as text" }));
    expect(all().map((paragraph) => paragraph.bulletSize)).toEqual([undefined, undefined, undefined]);
    click(within(screen.getByRole("dialog", { name: "Bullets and numbering" })).getByRole("button", { name: "Marker colour" }));
    click(within(screen.getByRole("dialog", { name: "Bullets and numbering" })).getByRole("button", { name: "accent2" }));
    expect(all().map((paragraph) => paragraph.bulletColor)).toEqual(["accent2", "accent2", undefined]);
  });

  it("clears formatting and opens the link dialog", async () => {
    const { session, ui, id, now } = await withBox();
    act(() => session.elements.setText(id, { paragraphs: [{ runs: [{ t: "Hello", b: true, color: "accent2", size: 30 }] }] }));
    click(button("Clear formatting"));
    expect(runsOf(now())).toEqual([{ t: "Hello" }]);
    click(button("Insert link"));
    expect(ui.state.dialog).toBe("link");
  });
});

describe("with a text box open", () => {
  it("sends the change to the box, shows how its words look, and follows the caret", async () => {
    const { session, ui, id, now } = await withBox();
    const before = JSON.stringify(now());
    session.startEditing(id);
    const editor = fakeTextBox({ bold: true, size: 40, font: "Georgia", align: "right", list: "number" });
    act(() => ui.setText(editor));
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement).value).toBe("40");
    expect(button("Font").textContent).toBe("Georgia");
    expect(button("Numbered list").getAttribute("aria-pressed")).toBe("true");

    click(button("Italic"));
    expect(editor.toggleItalic).toHaveBeenCalledTimes(1);
    click(button("Increase font size"));
    expect(editor.stepSize).toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Font size" }), { target: { value: "12" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Font size" }), { key: "Enter" });
    expect(editor.setSize).toHaveBeenCalledWith(12);
    click(button("Text colour"));
    click(screen.getByRole("button", { name: "accent4" }));
    expect(editor.setColor).toHaveBeenCalledWith("accent4");
    // The deck itself is untouched: the box writes its words when it is done.
    expect(JSON.stringify(now())).toBe(before);

    // The caret moves into plain words.
    editor.current = { ...editor.current, bold: false, size: null };
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement).value).toBe("22");
  });
});
