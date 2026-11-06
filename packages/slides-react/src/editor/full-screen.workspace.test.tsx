// Full screen inside the whole editor: the button, the menu item, the keys (Ctrl+Shift+F and Escape), the class the window is covered by,
// and leaving. The editor fills the app's window; the browser's own full screen is not used.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import shellCss from "./shell.css?raw";
import { FULL_SCREEN_ATTRIBUTE } from "./full-screen.ts";
import { bar, button, click, row } from "./menus/testing.ts";
import { openDeck } from "./filmstrip/test-support.ts";
import { Workspace } from "./SlidesEditor.tsx";

// The slide reads pointer capture, and the search dialog watches its list's size; jsdom has neither.
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  cleanup();
  document.body.removeAttribute(FULL_SCREEN_ATTRIBUTE);
});

const editor = () => document.querySelector<HTMLElement>(".ks-editor")!;
const chord = { key: "f", code: "KeyF", ctrlKey: true, altKey: true };
/** KastenFlow's own search over everything: the editor must not take it. */
const searchChord = { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true };
const escape = (target: Element | Document = document.body) => fireEvent.keyDown(target, { key: "Escape" });
const stage = () => screen.getByRole("application", { name: "Slide" });

async function open() {
  const made = await openDeck({ slides: 2 });
  render(<Workspace session={made.session} ui={made.ui} />);
  return made;
}

describe("the editor in full screen", () => {
  it("covers the window while the mode is on, and only then, and marks the page for the host", async () => {
    const { ui } = await open();
    expect(editor().classList.contains("is-fullscreen")).toBe(false);
    act(() => ui.setFullScreen(true));
    expect(editor().classList.contains("is-fullscreen")).toBe(true);
    expect(document.body.getAttribute(FULL_SCREEN_ATTRIBUTE)).toBe("true");
    act(() => ui.setFullScreen(false));
    expect(editor().classList.contains("is-fullscreen")).toBe(false);
    expect(document.body.hasAttribute(FULL_SCREEN_ATTRIBUTE)).toBe(false);
  });

  it("does not ask the browser for its own full screen", async () => {
    const request = vi.fn(async () => {});
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
    await open();
    click(button("Full screen"));
    expect(request).not.toHaveBeenCalled();
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  });

  it("is off after the editor goes away", async () => {
    const { ui } = await open();
    act(() => ui.setFullScreen(true));
    cleanup();
    expect(ui.state.fullScreen).toBe(false);
    expect(document.body.hasAttribute(FULL_SCREEN_ATTRIBUTE)).toBe(false);
  });

  it("is left by Back before the host is asked to close", async () => {
    const { ui } = await open();
    const seen: boolean[] = [];
    ui.actions = { close: () => void seen.push(ui.state.fullScreen) };
    await act(async () => {});
    act(() => ui.setFullScreen(true));
    click(button("Back"));
    expect(seen).toEqual([false]);
    expect(ui.state.fullScreen).toBe(false);
  });

  it("tells the host when it has a hook, which is where a desktop shell takes its own window full screen", async () => {
    const { ui } = await open();
    const fullScreen = vi.fn();
    ui.actions = { fullScreen };
    await act(async () => {});
    click(button("Full screen"));
    expect(fullScreen).toHaveBeenLastCalledWith(true);
    expect(editor().classList.contains("is-fullscreen")).toBe(true);
    click(button("Exit full screen"));
    expect(fullScreen).toHaveBeenLastCalledWith(false);
  });
});

describe("the ways in and out", () => {
  it("has a title bar button that shows it is on and says what a press does", async () => {
    const { ui } = await open();
    expect(button("Full screen").getAttribute("aria-pressed")).toBe("false");
    click(button("Full screen"));
    expect(ui.state.fullScreen).toBe(true);
    expect(button("Exit full screen").getAttribute("aria-pressed")).toBe("true");
    expect(button("Exit full screen").textContent).toBe("Exit full screen");
    click(button("Exit full screen"));
    expect(ui.state.fullScreen).toBe(false);
  });

  it("has a View menu item that shows the keys and whether it is on", async () => {
    const { ui } = await open();
    click(bar("View"));
    const item = row(/^Full screen/);
    expect(item.textContent).toContain("Ctrl+Alt+F");
    expect(item.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(item);
    expect(ui.state.fullScreen).toBe(true);
    click(bar("View"));
    expect(row(/^Full screen/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/^Full screen/));
    expect(ui.state.fullScreen).toBe(false);
  });

  it("answers Ctrl+Alt+F on the slide and in the filmstrip", async () => {
    const { ui } = await open();
    fireEvent.keyDown(stage(), chord);
    expect(ui.state.fullScreen).toBe(true);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Slides" }), chord);
    expect(ui.state.fullScreen).toBe(false);
  });

  it("leaves Ctrl+Shift+F to the app's search: the keypress is not taken", async () => {
    const { ui } = await open();
    expect(fireEvent.keyDown(stage(), searchChord)).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "Speaker notes for this slide" }), searchChord)).toBe(true);
    expect(ui.state.fullScreen).toBe(false);
  });

  it("answers Ctrl+Alt+F in the notes and in the deck title too, since it is never typing", async () => {
    const { ui } = await open();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Speaker notes for this slide" }), chord);
    expect(ui.state.fullScreen).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Deck title" }), chord);
    expect(ui.state.fullScreen).toBe(false);
  });

  it("leaves other chords in a field alone", async () => {
    const { session, ui } = await open();
    const notes = screen.getByRole("textbox", { name: "Speaker notes for this slide" });
    // Select all is the field's own (the slide has elements the editor's would select), and Ctrl+Shift+G is nothing at all.
    expect(session.slide.elements.length).toBeGreaterThan(0);
    expect(fireEvent.keyDown(notes, { key: "a", code: "KeyA", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(notes, { key: "G", code: "KeyG", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(session.state.selection).toEqual([]);
    expect(ui.state.fullScreen).toBe(false);
  });

  it("does not answer Ctrl+Alt+F while a dialog is open: the dialog has the keys", async () => {
    const { ui } = await open();
    act(() => ui.openDialog("shortcuts"));
    fireEvent.keyDown(screen.getByRole("dialog"), chord);
    expect(ui.state.fullScreen).toBe(false);
  });
});

describe("Escape in full screen", () => {
  it("cancels what the slide has open first, one thing for each press, and then leaves", async () => {
    const { session, ui } = await open();
    act(() => ui.setFullScreen(true));
    act(() => session.selectAll());
    expect(session.state.selection.length).toBeGreaterThan(0);
    act(() => session.setTool("shape:rect"));
    act(() => ui.setPreviewStep(1));
    stage().focus();

    // A step preview, then the tool, then the selection: each takes one press and the mode stays.
    escape(stage());
    expect(ui.state.previewStep).toBeNull();
    expect(ui.state.fullScreen).toBe(true);
    escape(stage());
    expect(session.state.tool).toBe("select");
    expect(ui.state.fullScreen).toBe(true);
    escape(stage());
    expect(session.state.selection).toEqual([]);
    expect(ui.state.fullScreen).toBe(true);
    // Nothing left to cancel.
    escape(stage());
    expect(ui.state.fullScreen).toBe(false);
  });

  it("ends the editing of a text box first", async () => {
    const { session, ui } = await open();
    act(() => ui.setFullScreen(true));
    const title = session.slide.elements.find((e) => e.placeholder === "title")!;
    act(() => session.startEditing(title.id));
    expect(session.state.editing).toBe(title.id);
    escape(document.querySelector<HTMLElement>(".ProseMirror") ?? stage());
    expect(session.state.editing).toBeNull();
    expect(ui.state.fullScreen).toBe(true);
    act(() => session.select([]));
    escape(stage());
    expect(ui.state.fullScreen).toBe(false);
  });

  it("leaves from anywhere else in the editor when nothing is open: the filmstrip, a toolbar button, the page", async () => {
    const { ui } = await open();
    for (const target of [screen.getByRole("listbox", { name: "Slides" }), button("Assistant"), document.body]) {
      act(() => ui.setFullScreen(true));
      escape(target);
      expect(ui.state.fullScreen, String((target as Element).tagName)).toBe(false);
    }
  });

  it("closes a menu first: the menu takes the key", async () => {
    const { ui } = await open();
    act(() => ui.setFullScreen(true));
    click(bar("View"));
    expect(screen.getByRole("menu")).toBeTruthy();
    escape(screen.getByRole("menu"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(ui.state.fullScreen).toBe(true);
    escape(stage());
    expect(ui.state.fullScreen).toBe(false);
  });

  it("closes a dialog first: the dialog takes the key", async () => {
    const { ui } = await open();
    act(() => ui.setFullScreen(true));
    act(() => ui.openDialog("shortcuts"));
    escape(screen.getByRole("dialog"));
    expect(ui.state.dialog).toBeNull();
    expect(ui.state.fullScreen).toBe(true);
    escape(stage());
    expect(ui.state.fullScreen).toBe(false);
  });

  it("is left to a field: the notes send the focus back to the slide, and the next press leaves", async () => {
    const { ui } = await open();
    act(() => ui.setFullScreen(true));
    const notes = screen.getByRole("textbox", { name: "Speaker notes for this slide" });
    notes.focus();
    escape(notes);
    expect(ui.state.fullScreen).toBe(true);
    expect(document.activeElement).toBe(stage());
    escape(stage());
    expect(ui.state.fullScreen).toBe(false);
  });

  it("does nothing when the editor is not in full screen", async () => {
    const { session, ui } = await open();
    expect(escape(stage())).toBe(true);
    expect(ui.state.fullScreen).toBe(false);
    expect(session.state.selection).toEqual([]);
  });
});

describe("what covers the window", () => {
  const rule = (selector: string): string => {
    const start = shellCss.indexOf(selector);
    expect(start, `${selector} in shell.css`).toBeGreaterThanOrEqual(0);
    return shellCss.slice(start, shellCss.indexOf("}", start));
  };

  it("is fixed to the window and above a host's own chrome, at a level the host can set", () => {
    const covering = rule(".ks-editor.is-fullscreen");
    expect(covering).toMatch(/position:\s*fixed/);
    expect(covering).toMatch(/inset:\s*0/);
    expect(covering).toMatch(/z-index:\s*var\(--ks-fullscreen-z,\s*\d+\)/);
  });

  it("keeps the page from scrolling behind it, so no scroll bar shows beside the editor", () => {
    expect(rule("body[data-ks-fullscreen]")).toMatch(/overflow:\s*hidden/);
  });
});
