import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shape, textBox } from "../factory.ts";
import { MenuBar } from "./MenuBar.tsx";
import { bar, click, isDisabled, menuOf, nextFrame, openEditor, row } from "./testing.ts";

afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  render(<MenuBar session={editor.session} ui={editor.ui} />);
  return editor;
}

describe("the menu bar", () => {
  it("has the nine menus of a slides editor, in order", async () => {
    await setup();
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["File", "Edit", "View", "Insert", "Format", "Slide", "Arrange", "Tools", "Help"]);
  });

  it("opens a menu on a click and runs a command from it", async () => {
    const { session } = await setup();
    click(bar("File"));
    expect(menuOf("File")).toBeTruthy();
    fireEvent.click(row(/^New slide/));
    expect(session.deck.slides).toHaveLength(2);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a second click on the same title, on Escape and on a press outside", async () => {
    await setup();
    click(bar("Edit"));
    expect(screen.getByRole("menu")).toBeTruthy();
    // The press that closes it comes first; the click that follows must not open it again.
    fireEvent.pointerDown(bar("Edit"));
    click(bar("Edit"));
    expect(screen.queryByRole("menu")).toBeNull();

    click(bar("Edit"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    click(bar("Edit"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("switches menus as the pointer passes over the bar once one is open", async () => {
    await setup();
    fireEvent.mouseEnter(bar("Edit"));
    expect(screen.queryByRole("menu")).toBeNull();
    click(bar("File"));
    fireEvent.mouseEnter(bar("Insert"));
    expect(menuOf("Insert")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    expect(bar("Insert").getAttribute("aria-expanded")).toBe("true");
  });

  it("opens with Down, moves between menus with Left and Right, and gives the focus back on Escape", async () => {
    await setup();
    bar("File").focus();
    fireEvent.keyDown(bar("File"), { key: "ArrowDown" });
    await nextFrame();
    const menu = menuOf("File");
    // The first row is ready for the next key.
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    await nextFrame();
    expect(menuOf("Edit")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    expect(menuOf("Edit").contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await nextFrame();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await nextFrame();
    expect(menuOf("Help")).toBeTruthy();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(bar("Help"));
  });

  it("takes the focus when it is opened with a click, so the arrow keys work, and gives it back", async () => {
    await setup();
    const slide = document.body.appendChild(document.createElement("div"));
    slide.tabIndex = 0;
    slide.focus();
    click(bar("Edit"));
    await nextFrame();
    expect(menuOf("Edit").contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(slide);

    click(bar("Edit"));
    await nextFrame();
    fireEvent.click(row(/^Select all/));
    expect(document.activeElement).toBe(slide);
    slide.remove();
  });

  it("moves along the bar with the arrow keys while no menu is open", async () => {
    await setup();
    bar("File").focus();
    fireEvent.keyDown(bar("File"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(bar("Edit"));
    fireEvent.keyDown(bar("Edit"), { key: "End" });
    expect(document.activeElement).toBe(bar("Help"));
    fireEvent.keyDown(bar("Help"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(bar("File"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not let a key pressed in an open menu reach the editor's shortcuts", async () => {
    const { session } = await setup();
    const [id] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]);
    session.select([id!]);
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    click(bar("Edit"));
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    document.body.removeEventListener("keydown", outer);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(true);
  });
});

describe("the Edit menu", () => {
  it("says what Undo and Redo would do, and disables them when they cannot", async () => {
    const { session } = await setup();
    click(bar("Edit"));
    expect(row(/^Undo/).textContent).toMatch(/^Undo(?!\s\w)/);
    expect(isDisabled(row(/^Undo/))).toBe(true);
    expect(isDisabled(row(/^Redo/))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });

    act(() => void session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]));
    act(() => session.elements.nudge(5, 5, session.slide.elements.slice(-1).map((e) => e.id)));
    click(bar("Edit"));
    expect(row(/^Undo Move elements/)).toBeTruthy();
    expect(isDisabled(row(/^Undo/))).toBe(false);
    fireEvent.click(row(/^Undo/));
    click(bar("Edit"));
    expect(row(/^Redo Move elements/)).toBeTruthy();
    expect(isDisabled(row(/^Redo/))).toBe(false);
  });

  it("disables what needs a selection, and acts on the selection", async () => {
    const { session } = await setup();
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]);
    act(() => session.select([]));
    click(bar("Edit"));
    for (const name of [/^Cut/, /^Copy/, /^Duplicate/, /^Delete/]) expect(isDisabled(row(name)), String(name)).toBe(true);
    expect(isDisabled(row(/^Paste(?! in place)/))).toBe(false);
    expect(isDisabled(row(/^Paste in place/))).toBe(false);
    expect(isDisabled(row(/^Select all/))).toBe(false);
    fireEvent.keyDown(document.body, { key: "Escape" });

    act(() => session.select([a!]));
    click(bar("Edit"));
    expect(isDisabled(row(/^Delete/))).toBe(false);
    fireEvent.click(row(/^Delete/));
    expect(session.slide.elements.some((e) => e.id === a)).toBe(false);
  });

  it("selects all elements on the slide", async () => {
    const { session } = await setup();
    session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 }), textBox({ x: 100, y: 10, w: 60, h: 30 }, "x")]);
    act(() => session.select([]));
    click(bar("Edit"));
    fireEvent.click(row(/^Select all/));
    expect(session.state.selection).toHaveLength(session.slide.elements.length);
  });

  it("opens find and replace", async () => {
    const { ui } = await setup();
    click(bar("Edit"));
    fireEvent.click(row(/^Find and replace/));
    expect(ui.state.dialog).toBe("find");
  });
});

describe("the File menu", () => {
  it("offers the five downloads and print when the host can do them, and not otherwise", async () => {
    const { ui } = await setup();
    click(bar("File"));
    expect(isDisabled(row(/^Download/))).toBe(true);
    expect(isDisabled(row(/^Print/))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });

    const exportAs = vi.fn();
    const print = vi.fn();
    act(() => void (ui.actions = { exportAs, print }));
    click(bar("File"));
    fireEvent.click(row(/^Download/));
    for (const name of [/^Microsoft PowerPoint/, /^PDF document/, /^PNG image/, /^Markdown outline/, /^Web page/]) expect(isDisabled(row(name)), String(name)).toBe(false);
    // A picture has a size and a PDF is made by printing: both ask what they need first.
    fireEvent.click(row(/^PNG image/));
    expect(ui.state.dialog).toBe("png");
    expect(exportAs).not.toHaveBeenCalled();
    act(() => ui.openDialog(null));
    click(bar("File"));
    fireEvent.click(row(/^Download/));
    fireEvent.click(row(/^PDF document/));
    expect(ui.state.dialog).toBe("export");
    act(() => ui.openDialog(null));
    click(bar("File"));
    fireEvent.click(row(/^Print/));
    expect(ui.state.dialog).toBe("export");
    expect(print).not.toHaveBeenCalled();
  });
});
