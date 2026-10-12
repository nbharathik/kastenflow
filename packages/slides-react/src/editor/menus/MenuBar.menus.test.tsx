import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shape, textBox } from "../factory.ts";
import { MenuBar } from "./MenuBar.tsx";
import { bar, click, fakeTextBox, isDisabled, openEditor, row } from "./testing.ts";

afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  render(<MenuBar session={editor.session} ui={editor.ui} />);
  return editor;
}

describe("the View menu", () => {
  it("sets the zoom from its sub-menu and checks the one in use", async () => {
    const { ui } = await setup();
    click(bar("View"));
    fireEvent.click(row(/^Zoom/));
    expect(row(/^Fit/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row("150%"));
    expect(ui.state.zoom).toBe(1.5);

    click(bar("View"));
    fireEvent.click(row(/^Zoom/));
    expect(row("150%").getAttribute("aria-checked")).toBe("true");
    expect(row(/^Fit/).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row(/^100%/));
    expect(ui.state.zoom).toBe(1);
  });

  it("switches views and toggles notes, filmstrip and snapping", async () => {
    const { ui } = await setup();
    click(bar("View"));
    fireEvent.click(row(/^Views/));
    expect(row(/^Slide editor/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Grid view/));
    expect(ui.state.view).toBe("grid");

    click(bar("View"));
    expect(row(/^Speaker notes/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Speaker notes/));
    expect(ui.state.notesOpen).toBe(false);
    click(bar("View"));
    fireEvent.click(row(/^Snap to guides/));
    expect(ui.state.snap).toBe(false);
    click(bar("View"));
    fireEvent.click(row(/^Filmstrip/));
    expect(ui.state.filmstripOpen).toBe(false);
    click(bar("View"));
    fireEvent.click(row(/^Format options/));
    expect(ui.state.panel).toBe("format");
  });

  it("presents when the host can", async () => {
    const { ui } = await setup();
    click(bar("View"));
    expect(isDisabled(row(/^Present from beginning/))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    const present = vi.fn();
    ui.actions = { present };
    click(bar("View"));
    fireEvent.click(row(/^Present from beginning/));
    expect(present).toHaveBeenCalledWith("start");
  });
});

describe("the Insert menu", () => {
  it("arms the text box tool", async () => {
    const { session } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Text & content/));
    fireEvent.click(row(/^Text box/));
    expect(session.state.tool).toBe("text");
  });

  it("has two levels: six groups, each opening onto its items", async () => {
    await setup();
    click(bar("Insert"));
    const groups = [...screen.getAllByRole("menu")[0]!.querySelectorAll(":scope > button > .ks-menu-label")].map((r) => r.textContent);
    expect(groups).toEqual([
      "Text & content",
      "Media",
      "Shapes & lines",
      "Data",
      "Pages & links",
      "Smart parts",
      "Insert gallery…",
      "New slide",
    ]);
    fireEvent.click(row(/^Smart parts/));
    // Each item says what it makes.
    expect(row(/^Conversation/).textContent).toMatch(/a person and an assistant/);
    expect(row(/^Card grid/)).toBeTruthy();
    expect(row(/^Step label/)).toBeTruthy();
  });

  it("lists nothing that cannot be made yet: no chart, timer or QR code", async () => {
    await setup();
    click(bar("Insert"));
    for (const group of [/^Text & content/, /^Media/, /^Data/, /^Pages & links/, /^Smart parts/]) {
      fireEvent.click(row(group));
      expect(screen.queryByRole("menuitem", { name: /^(Chart|Timer|QR code)/ })).toBeNull();
    }
  });

  it("arms a shape from the sub-menu of its group", async () => {
    const { session } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Shapes & lines/));
    for (const group of ["Shapes", "Arrows", "Callouts", "Flowchart"]) expect(row(group)).toBeTruthy();
    fireEvent.click(row("Arrows"));
    fireEvent.click(row(/^Right arrow/));
    expect(session.state.tool).toBe("shape:rightArrow");
  });

  it("arms a line or an arrow", async () => {
    const { session } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Shapes & lines/));
    fireEvent.click(row(/^Lines & arrows/));
    fireEvent.click(row(/^Elbow arrow connector/));
    expect(session.state.tool).toBe("arrow:elbow");
  });

  it("opens the images drawer and the table dialog", async () => {
    const { ui } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Media/));
    fireEvent.click(row(/^Image from the gallery/));
    expect(ui.state.galleryOpen).toBe(true);
    expect(ui.state.dialog).toBeNull();
    click(bar("Insert"));
    fireEvent.click(row(/^Data/));
    fireEvent.click(row(/^Table/));
    expect(ui.state.dialog).toBe("table");
  });
});

describe("the Format menu", () => {
  it("is disabled while there is no text to format", async () => {
    await setup();
    click(bar("Format"));
    expect(isDisabled(row(/^Text$/))).toBe(true);
    expect(isDisabled(row(/^Bullets & numbering/))).toBe(true);
    expect(isDisabled(row(/^Line & paragraph spacing/))).toBe(true);
    expect(isDisabled(row(/^Clear formatting/))).toBe(true);
  });

  it("formats all the words of the selected box, and shows what they look like", async () => {
    const { session } = await setup();
    const [box] = session.elements.insert([textBox({ x: 10, y: 10, w: 300, h: 60 }, "Hello world")]);
    click(bar("Format"));
    fireEvent.click(row(/^Text$/));
    expect(row(/^Bold/).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row(/^Bold/));
    const runs = () => (session.elements.find([box!])[0] as { text: { paragraphs: { runs: { b?: boolean }[] }[] } }).text.paragraphs[0]!.runs;
    expect(runs().every((r) => r.b)).toBe(true);

    click(bar("Format"));
    fireEvent.click(row(/^Text$/));
    expect(row(/^Bold/).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });

    click(bar("Format"));
    fireEvent.click(row(/^Align & indent/));
    expect(row(/^Align left/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Align centre/));
    expect((session.elements.find([box!])[0] as { text: { paragraphs: { align?: string }[] } }).text.paragraphs[0]!.align).toBe("center");
  });

  it("sets the line spacing, with Default putting the text style's back", async () => {
    const { session } = await setup();
    const [box] = session.elements.insert([textBox({ x: 10, y: 10, w: 300, h: 60 }, "Hello")]);
    const spacing = () => (session.elements.find([box!])[0] as { text: { paragraphs: { lineSpacing?: number }[] } }).text.paragraphs[0]!.lineSpacing;
    click(bar("Format"));
    fireEvent.click(row(/^Line & paragraph spacing/));
    expect(row("Default").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row("1.5"));
    expect(spacing()).toBe(1.5);
    click(bar("Format"));
    fireEvent.click(row(/^Line & paragraph spacing/));
    expect(row("1.5").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row("Default"));
    expect(spacing()).toBeUndefined();
  });

  it("sends the change to the open text box, not to the whole element, and leaves the focus in the box", async () => {
    const { session, ui } = await setup();
    const [box] = session.elements.insert([textBox({ x: 10, y: 10, w: 300, h: 60 }, "Hello")]);
    session.startEditing(box!);
    const editor = fakeTextBox({ bold: true });
    act(() => ui.setText(editor));
    const field = document.body.appendChild(document.createElement("textarea"));
    field.focus();

    click(bar("Format"));
    // The menu did not take the focus from the box.
    expect(document.activeElement).toBe(field);
    fireEvent.click(row(/^Text$/));
    expect(row(/^Bold/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Italic/));
    expect(editor.toggleItalic).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("opens the link dialog", async () => {
    const { session, ui } = await setup();
    session.elements.insert([textBox({ x: 10, y: 10, w: 300, h: 60 }, "Hello")]);
    click(bar("Format"));
    fireEvent.click(row(/^Insert link/));
    expect(ui.state.dialog).toBe("link");
  });
});

describe("the Slide menu", () => {
  it("adds, duplicates, hides and moves slides", async () => {
    const { session, ui } = await setup();
    click(bar("Slide"));
    fireEvent.click(row(/^New slide/));
    expect(session.deck.slides).toHaveLength(2);
    click(bar("Slide"));
    fireEvent.click(row(/^Duplicate slide/));
    expect(session.deck.slides).toHaveLength(3);

    click(bar("Slide"));
    fireEvent.click(row(/^Skip slide/));
    expect(session.slide.hidden).toBe(true);
    click(bar("Slide"));
    expect(row(/^Skip slide/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Skip slide/));
    expect(session.slide.hidden).toBeFalsy();

    const last = session.state.slideId;
    click(bar("Slide"));
    fireEvent.click(row(/^Move slide/));
    fireEvent.click(row(/^Move slide to beginning/));
    expect(session.deck.slides[0]?.id).toBe(last);

    click(bar("Slide"));
    fireEvent.click(row(/^Change background/));
    expect(ui.state.dialog).toBe("background");
    click(bar("Slide"));
    fireEvent.click(row(/^Change layout/));
    expect(ui.state.dialog).toBe("layouts");
    click(bar("Slide"));
    fireEvent.click(row(/^Transition/));
    expect(ui.state.panel).toBe("transitions");
    click(bar("Slide"));
    fireEvent.click(row(/^Edit theme/));
    expect(ui.state.dialog).toBe("theme");
  });
});

describe("the Arrange menu", () => {
  it("does nothing without a selection, and orders, aligns, groups and locks a selection", async () => {
    const { session } = await setup();
    const [a, b, c] = session.elements.insert([
      shape("rect", { x: 10, y: 10, w: 50, h: 50 }),
      shape("rect", { x: 100, y: 40, w: 50, h: 50 }),
      shape("rect", { x: 300, y: 70, w: 50, h: 50 }),
    ]) as [string, string, string];
    act(() => session.select([]));
    click(bar("Arrange"));
    expect(isDisabled(row(/^Order/))).toBe(true);
    expect(isDisabled(row(/^Group/))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });

    act(() => session.select([a]));
    click(bar("Arrange"));
    fireEvent.click(row(/^Order/));
    fireEvent.click(row(/^Bring to front/));
    expect(session.slide.elements.at(-1)?.id).toBe(a);

    act(() => session.select([a, b, c]));
    click(bar("Arrange"));
    fireEvent.click(row(/^Align vertically/));
    fireEvent.click(row("Top"));
    const tops = session.elements.find([a, b, c]).map((e) => e.y);
    expect(new Set(tops).size).toBe(1);

    click(bar("Arrange"));
    fireEvent.click(row(/^Distribute/));
    expect(isDisabled(row("Horizontally"))).toBe(false);
    fireEvent.keyDown(document.body, { key: "Escape" });

    click(bar("Arrange"));
    fireEvent.click(row(/^Lock/));
    expect(session.elements.find([a, b, c]).every((e) => e.locked)).toBe(true);
    click(bar("Arrange"));
    expect(row(/^Lock/).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });

    act(() => session.select([a, b]));
    click(bar("Arrange"));
    fireEvent.click(row(/^Group/));
    expect(session.slide.elements.some((e) => e.type === "group")).toBe(true);
    click(bar("Arrange"));
    expect(isDisabled(row(/^Ungroup(?! to shapes)/))).toBe(false);
  });

  it("turns and flips", async () => {
    const { session } = await setup();
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]) as [string];
    click(bar("Arrange"));
    fireEvent.click(row(/^Rotate/));
    fireEvent.click(row(/^Rotate clockwise/));
    expect(session.elements.find([a])[0]?.rotation).toBe(90);
    click(bar("Arrange"));
    fireEvent.click(row(/^Rotate/));
    fireEvent.click(row(/^Flip horizontally/));
    expect(session.elements.find([a])[0]?.flipH).toBe(true);
  });
});

describe("Tools and Help", () => {
  it("finds and replaces, and lists the shortcuts", async () => {
    const { ui } = await setup();
    click(bar("Tools"));
    fireEvent.click(row(/^Find and replace/));
    expect(ui.state.dialog).toBe("find");
    click(bar("Help"));
    fireEvent.click(row(/^Keyboard shortcuts/));
    expect(ui.state.dialog).toBe("shortcuts");
  });
});
