import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { line, shape, textBox } from "../factory.ts";
import { ContextMenus } from "./ContextMenus.tsx";
import { fakeTextBox, isDisabled, nextFrame, openEditor, row } from "./testing.ts";

afterEach(cleanup);

const has = (name: string | RegExp) => [...screen.queryAllByRole("menuitem"), ...screen.queryAllByRole("menuitemcheckbox")].some((el) => (typeof name === "string" ? el.textContent === name : name.test(el.textContent ?? "")));
/** The labels of the rows of the open menu, or of the sub-menu opened from it with `depth` 1. */
const names = (depth = 0) => [...(screen.getAllByRole("menu")[depth]?.querySelectorAll(":scope > button > .ks-menu-label") ?? [])].map((r) => r.textContent);

async function setup() {
  const editor = await openEditor();
  render(<ContextMenus session={editor.session} ui={editor.ui} />);
  const insert = (...elements: Element[]) => {
    let ids: string[] = [];
    act(() => {
      ids = editor.session.elements.insert(elements);
    });
    return ids;
  };
  const open = (kind: "element" | "canvas" | "slide", x = 120, y = 80) => act(() => editor.ui.openContextMenu({ kind, x, y }));
  return { ...editor, insert, open };
}

describe("the context menu while a text box is being edited", () => {
  it("leaves the focus in the text, and Select all takes the words of the box, not the elements of the slide", async () => {
    const { session, ui, open } = await setup();
    const box = fakeTextBox();
    act(() => ui.setText(box));
    const editor = document.body.appendChild(document.createElement("div"));
    editor.tabIndex = 0;
    editor.focus();
    open("canvas");
    await nextFrame();
    expect(document.activeElement).toBe(editor);
    fireEvent.click(row(/^Select all/));
    expect(box.selectAll).toHaveBeenCalledTimes(1);
    expect(session.state.selection).toEqual([]);
    editor.remove();
  });
});

describe("the context menu", () => {
  it("shows nothing until a right click asks for it, and opens where the pointer is", async () => {
    const { open } = await setup();
    expect(screen.queryByRole("menu")).toBeNull();
    open("canvas", 120, 80);
    const popover = screen.getByRole("dialog", { name: "Context menu" });
    expect(popover.style.left).toBe("120px");
    expect(popover.style.top).toBe("80px");
  });

  it("closes on Escape, on a press outside, and after a row is chosen", async () => {
    const { ui, open } = await setup();
    open("canvas");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(ui.state.contextMenu).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    open("canvas");
    fireEvent.pointerDown(document.body);
    expect(ui.state.contextMenu).toBeNull();

    open("canvas");
    fireEvent.click(row(/^Select all/));
    expect(ui.state.contextMenu).toBeNull();
  });

  it("gives the focus back to what had it", async () => {
    const { open } = await setup();
    const slide = document.body.appendChild(document.createElement("div"));
    slide.tabIndex = 0;
    slide.focus();
    open("canvas");
    expect(document.activeElement).not.toBe(slide);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.activeElement).toBe(slide);
    slide.remove();
  });
});

describe("on an element", () => {
  it("offers to cut, copy, paste, duplicate and delete, and does it", async () => {
    const { session, insert, open } = await setup();
    const [a] = insert(shape("rect", { x: 10, y: 10, w: 100, h: 100 })) as [string];
    open("element");
    for (const name of [/^Cut/, /^Copy/, /^Paste(?! in place)/, /^Paste in place/, /^Duplicate/, /^Delete/]) expect(isDisabled(row(name)), String(name)).toBe(false);
    fireEvent.click(row(/^Duplicate/));
    expect(session.slide.elements.filter((e) => e.type === "shape")).toHaveLength(2);
    open("element");
    fireEvent.click(row(/^Delete/));
    expect(session.slide.elements.filter((e) => e.type === "shape")).toHaveLength(1);
    expect(a).toBeTruthy();
  });

  it("has Order, Rotate & flip and the rest, and Align to the slide for one and to each other for two or more", async () => {
    const { session, insert, open } = await setup();
    const [a, b] = insert(shape("rect", { x: 10, y: 10, w: 100, h: 100 }), shape("rect", { x: 200, y: 50, w: 100, h: 100 })) as [string, string];
    act(() => session.select([a]));
    open("element");
    for (const name of [/^Order/, /^Rotate & flip/, /^Align to slide/, /^Group/, /^Lock/, /^Format options/, /^Edit text/, /^Link…/]) expect(has(name), String(name)).toBe(true);
    expect(isDisabled(row(/^Group/))).toBe(true);
    expect(has(/^Ungroup/)).toBe(false);
    // One thing aligns to the slide: there is nothing to space out, so no Distribute rows.
    fireEvent.click(row(/^Align to slide/));
    expect(has(/^Distribute/)).toBe(false);
    fireEvent.click(row("Left"));
    expect(session.elements.find([a])[0]?.x).toBe(0);
    open("element");
    fireEvent.click(row(/^Order/));
    fireEvent.click(row(/^Bring to front/));
    expect(session.slide.elements.at(-1)?.id).toBe(a);

    act(() => session.select([a, b]));
    open("element");
    expect(has(/^Align$/)).toBe(true);
    expect(isDisabled(row(/^Group/))).toBe(false);
    fireEvent.click(row(/^Align/));
    fireEvent.click(row("Top"));
    const [top1, top2] = session.elements.find([a, b]).map((e) => e.y);
    expect(top1).toBe(top2);
    // Distributing needs three.
    open("element");
    fireEvent.click(row(/^Align/));
    expect(isDisabled(row("Distribute horizontally"))).toBe(true);
  });

  it("groups, and offers to ungroup a group", async () => {
    const { session, insert, open } = await setup();
    const [a, b] = insert(shape("rect", { x: 10, y: 10, w: 100, h: 100 }), shape("rect", { x: 200, y: 50, w: 100, h: 100 })) as [string, string];
    act(() => session.select([a, b]));
    open("element");
    fireEvent.click(row(/^Group/));
    const group = session.slide.elements.find((e) => e.type === "group");
    expect(group).toBeTruthy();
    open("element");
    expect(has(/^Ungroup/)).toBe(true);
    expect(has(/^Group$/)).toBe(false);
    fireEvent.click(row(/^Ungroup/));
    expect(session.slide.elements.some((e) => e.type === "group")).toBe(false);
  });

  it("locks and unlocks, and says which", async () => {
    const { session, insert, open } = await setup();
    const [a] = insert(shape("rect", { x: 10, y: 10, w: 100, h: 100 })) as [string];
    open("element");
    fireEvent.click(row("Lock"));
    expect(session.elements.find([a])[0]?.locked).toBe(true);
    act(() => session.select([a]));
    open("element");
    expect(has("Lock")).toBe(false);
    fireEvent.click(row("Unlock"));
    expect(session.elements.find([a])[0]?.locked).toBeFalsy();
  });

  it("opens the format options, the link dialog, and the text for editing", async () => {
    const { session, ui, insert, open } = await setup();
    const [box] = insert(textBox({ x: 10, y: 10, w: 200, h: 60 }, "Hello")) as [string];
    open("element");
    fireEvent.click(row(/^Format options/));
    expect(ui.state.panel).toBe("format");
    // It opens the panel and does not toggle it shut.
    open("element");
    fireEvent.click(row(/^Format options/));
    expect(ui.state.panel).toBe("format");

    open("element");
    fireEvent.click(row(/^Link…/));
    expect(ui.state.dialog).toBe("link");

    open("element");
    fireEvent.click(row("Edit text"));
    expect(session.state.editing).toBe(box);
  });

  it("does not offer Edit text on a line", async () => {
    const { insert, open } = await setup();
    insert(line("straight", false, { x: 10, y: 10 }, { x: 100, y: 100 }));
    open("element");
    expect(has("Edit text")).toBe(false);
  });

  it("turns and flips", async () => {
    const { session, insert, open } = await setup();
    const [a] = insert(shape("rect", { x: 10, y: 10, w: 100, h: 100 })) as [string];
    open("element");
    fireEvent.click(row(/^Rotate & flip/));
    expect(names(1)).toEqual(["Rotate clockwise 90°", "Rotate counterclockwise 90°", "Flip horizontally", "Flip vertically"]);
    fireEvent.click(row(/^Rotate counterclockwise/));
    expect(session.elements.find([a])[0]?.rotation).toBe(270);
  });
});

describe("on the empty slide", () => {
  it("offers paste, paste in place, select all, layout, background, and the notes and snapping switches", async () => {
    const { session, ui, insert, open } = await setup();
    insert(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    act(() => session.select([]));
    open("canvas");
    expect(names()).toEqual(["Paste", "Paste in place", "Select all", "Change layout…", "Change background…", "Speaker notes", "Snap to guides"]);
    expect(row(/^Speaker notes/).getAttribute("aria-checked")).toBe("true");
    expect(row(/^Snap to guides/).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(row(/^Select all/));
    expect(session.state.selection.length).toBeGreaterThan(0);
    open("canvas");
    fireEvent.click(row(/^Change layout/));
    expect(ui.state.dialog).toBe("layouts");
    open("canvas");
    fireEvent.click(row(/^Change background/));
    expect(ui.state.dialog).toBe("background");
    open("canvas");
    fireEvent.click(row(/^Speaker notes/));
    expect(ui.state.notesOpen).toBe(false);
    open("canvas");
    expect(row(/^Speaker notes/).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row(/^Snap to guides/));
    expect(ui.state.snap).toBe(false);
  });
});

describe("on a slide in the filmstrip", () => {
  it("adds, duplicates and deletes slides", async () => {
    const { session, open } = await setup();
    open("slide");
    expect(names()).toEqual(["Cut", "Copy", "Paste", "New slide", "Duplicate slide", "Delete slide", "Select all slides", "Skip slide", "Backup slide", "Move slide", "Change layout…", "Change background…", "Add section here", "Rename section", "Remove section"]);
    fireEvent.click(row(/^New slide/));
    expect(session.deck.slides).toHaveLength(2);
    open("slide");
    fireEvent.click(row(/^Duplicate slide/));
    expect(session.deck.slides).toHaveLength(3);
    open("slide");
    fireEvent.click(row(/^Delete slide/));
    expect(session.deck.slides).toHaveLength(2);
  });

  it("checks Skip and Backup for the slides picked, and toggles them", async () => {
    const { session, open } = await setup();
    act(() => void session.slides.add());
    open("slide");
    expect(row(/^Skip slide/).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row(/^Skip slide/));
    expect(session.slide.hidden).toBe(true);
    open("slide");
    expect(row(/^Skip slide/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Backup slide/));
    expect(session.slide.backup).toBe(true);
  });

  it("moves the slide from its sub-menu, and opens the layout and background dialogs", async () => {
    const { session, ui, open } = await setup();
    act(() => void session.slides.add());
    const second = session.state.slideId;
    open("slide");
    fireEvent.click(row(/^Move slide/));
    fireEvent.click(row(/^Move slide up/));
    expect(session.deck.slides[0]?.id).toBe(second);
    open("slide");
    fireEvent.click(row(/^Change layout/));
    expect(ui.state.dialog).toBe("layouts");
    open("slide");
    fireEvent.click(row(/^Change background/));
    expect(ui.state.dialog).toBe("background");
  });
});
