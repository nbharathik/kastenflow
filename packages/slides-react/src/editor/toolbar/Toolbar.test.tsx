import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shape, textBox } from "../factory.ts";
import { button, click, isDisabled, nextFrame, openEditor, row } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  return editor;
}

/** The names of the buttons in the bar, in order; Undo and Redo name what they would undo, which is not what is looked at here. */
function barNames(): string[] {
  return within(screen.getByRole("toolbar"))
    .getAllByRole("button")
    .map((b) => (b.getAttribute("aria-label") ?? "").replace(/^(Undo|Redo) .*/, "$1"));
}

describe("the toolbar", () => {
  it("has the tools for the slide, in order, when nothing is selected, and is a toolbar", async () => {
    const { session } = await setup();
    act(() => session.select([]));
    expect(barNames()).toEqual(["Undo", "Redo", "Paint format", "Zoom", "Insert gallery…", "Select", "Text box", "Image", "Shape", "Line", "Background", "Layout", "Theme", "Transition", "Format options"]);
    // The groups are named for a screen reader.
    for (const group of ["History", "Zoom", "Insert", "Slide"]) expect(screen.getByRole("group", { name: group }), group).toBeTruthy();
  });

  it("swaps to the tools for a text box when one is selected, and leaves out what does not apply", async () => {
    const { session } = await setup();
    act(() => {
      const [id] = session.elements.insert([textBox({ x: 40, y: 40, w: 300, h: 60 }, "Words")]) as [string];
      session.select([id]);
    });
    expect(barNames()).toEqual([
      "Undo", "Redo", "Paint format", "Zoom",
      "Font", "Decrease font size", "Font sizes", "Increase font size",
      "Bold", "Italic", "Underline", "Strikethrough", "Text colour", "Insert link",
      "Align", "Line and paragraph spacing", "Bulleted list", "Numbered list", "Bullets and numbering", "Decrease indent", "Increase indent", "Clear formatting",
      "Fill colour", "Border colour", "Border weight", "Border dash", "Shadow", "Opacity",
      "Order", "Align objects", "Animate",
      "Format options",
    ]);
    // Nothing is greyed: the tools for adding things are not here at all.
    expect(screen.queryByRole("button", { name: "Text box" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Background" })).toBeNull();
  });

  it("keeps the font and the paragraph out of the bar for a picture, which has no words", async () => {
    const { session } = await setup();
    act(() => {
      const [id] = session.elements.insert([{ type: "image", id: "", src: "assets/x.png", x: 0, y: 0, w: 100, h: 100 } as Element]) as [string];
      session.select([id]);
    });
    expect(barNames()).toEqual(["Undo", "Redo", "Paint format", "Zoom", "Border colour", "Border weight", "Border dash", "Shadow", "Opacity", "Order", "Align objects", "Animate", "Format options"]);
  });

  it("comes back to the insert tools when the selection is cleared", async () => {
    const { session } = await setup();
    act(() => {
      const [id] = session.elements.insert([textBox({ x: 40, y: 40, w: 300, h: 60 }, "Words")]) as [string];
      session.select([id]);
    });
    expect(screen.queryByRole("button", { name: "Bold" })).toBeTruthy();
    act(() => session.select([]));
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Text box" })).toBeTruthy();
  });

  it("opens the format options from the button at its right edge, and shows them open", async () => {
    const { ui } = await setup();
    expect(button("Format options").getAttribute("aria-pressed")).toBe("false");
    click(button("Format options"));
    expect(ui.state.panel).toBe("format");
    expect(button("Format options").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not take the focus from a text box: its buttons are marked and the mouse leaves the focus", async () => {
    await setup();
    for (const b of within(screen.getByRole("toolbar")).getAllByRole("button")) expect(b.hasAttribute("data-ks-keep-focus"), b.getAttribute("aria-label") ?? "").toBe(true);
    const pressed = fireEvent.mouseDown(button("Select"));
    // fireEvent returns false when a handler called preventDefault, which is what keeps the focus where it is.
    expect(pressed).toBe(false);
  });
});

describe("undo, redo and zoom", () => {
  it("say what they would undo, and are on only when there is something to do", async () => {
    const { session } = await setup();
    expect(isDisabled(button(/^Undo/))).toBe(true);
    expect(isDisabled(button(/^Redo/))).toBe(true);
    act(() => void session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]));
    expect(button(/^Undo/).getAttribute("aria-label")).toBe("Undo Add elements");
    expect(button(/^Undo/).getAttribute("data-tip")).toMatch(/^Undo Add elements \((Ctrl\+Z|⌘Z)\)$/);
    click(button(/^Undo/));
    expect(session.slide.elements.some((e) => e.type === "shape")).toBe(false);
    expect(button(/^Redo/).getAttribute("aria-label")).toBe("Redo Add elements");
    click(button(/^Redo/));
    expect(session.slide.elements.some((e) => e.type === "shape")).toBe(true);
  });

  it("shows Fit, then the zoom picked from the menu, and checks it", async () => {
    const { ui } = await setup();
    expect(button("Zoom").textContent).toBe("Fit");
    click(button("Zoom"));
    expect(row(/^Fit/).getAttribute("aria-checked")).toBe("true");
    click(row("150%"));
    expect(ui.state.zoom).toBe(1.5);
    expect(button("Zoom").textContent).toBe("150%");
    click(button("Zoom"));
    expect(row("150%").getAttribute("aria-checked")).toBe("true");
    click(row(/^Fit/));
    expect(button("Zoom").textContent).toBe("Fit");
  });

  it("closes the menu on a second click on the button", async () => {
    await setup();
    click(button("Zoom"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(button("Zoom"));
    click(button("Zoom"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("what goes on the slide", () => {
  it("marks the tool in use, and arms the tools", async () => {
    const { session } = await setup();
    expect(button("Select").getAttribute("aria-pressed")).toBe("true");
    click(button("Text box"));
    expect(session.state.tool).toBe("text");
    expect(button("Text box").getAttribute("aria-pressed")).toBe("true");
    expect(button("Select").getAttribute("aria-pressed")).toBe("false");
    click(button("Select"));
    expect(session.state.tool).toBe("select");
  });

  it("arms a shape from the grid of outlines, grouped by title", async () => {
    const { session } = await setup();
    click(button("Shape"));
    const grid = screen.getByRole("dialog", { name: "Shapes" });
    for (const group of ["Shapes", "Arrows", "Callouts", "Flowchart"]) expect(within(grid).getByRole("group", { name: group })).toBeTruthy();
    // Each cell is a small drawing of the shape.
    expect(within(grid).getByRole("button", { name: "Oval" }).querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    click(within(grid).getByRole("button", { name: "Oval" }));
    expect(session.state.tool).toBe("shape:ellipse");
    expect(screen.queryByRole("dialog", { name: "Shapes" })).toBeNull();
    expect(button("Shape").getAttribute("aria-pressed")).toBe("true");
    click(button("Shape"));
    expect(within(screen.getByRole("dialog", { name: "Shapes" })).getByRole("button", { name: "Oval" }).className).toContain("is-on");
  });

  it("moves between the shapes with the arrow keys, and closes on Escape", async () => {
    await setup();
    fireEvent.click(button("Shape"));
    await nextFrame();
    const grid = screen.getByRole("dialog", { name: "Shapes" });
    const first = within(grid).getByRole("button", { name: "Rectangle" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(within(grid).getByRole("button", { name: "Rounded rectangle" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Shapes" })).toBeNull();
  });

  it("arms a line, an arrow or a connector, and opens the image sources", async () => {
    const { session, ui } = await setup();
    click(button("Line"));
    click(row(/^Curved arrow connector/));
    expect(session.state.tool).toBe("arrow:curved");
    expect(button("Line").getAttribute("aria-pressed")).toBe("true");
    click(button("Image"));
    click(row(/^Image from the gallery/));
    expect(ui.state.galleryOpen).toBe(true);
  });
});

describe("the slide's own buttons", () => {
  it("change the layout, checking the one in use", async () => {
    const { session } = await setup();
    click(button("Layout"));
    expect(row("Title").getAttribute("aria-checked")).toBe("true");
    click(row("Two columns"));
    expect(session.slide.layout).toBe("two-columns");
    click(button("Layout"));
    expect(row("Two columns").getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("menuitemcheckbox").length).toBe(session.deck.theme.layouts.length);
  });

  it("open the themes panel, and the transitions panel, and show them open", async () => {
    const { ui } = await setup();
    expect(button("Theme").getAttribute("aria-pressed")).toBe("false");
    click(button("Theme"));
    expect(ui.state.panel).toBe("themes");
    expect(button("Theme").getAttribute("aria-pressed")).toBe("true");
    click(button("Transition"));
    expect(ui.state.panel).toBe("transitions");
    expect(button("Theme").getAttribute("aria-pressed")).toBe("false");
    expect(button("Transition").getAttribute("aria-pressed")).toBe("true");
    click(button("Transition"));
    expect(ui.state.panel).toBeNull();
  });

  it("open the background dialog, and the dialog of layouts from the end of the layout list", async () => {
    const { ui } = await setup();
    click(button("Background"));
    expect(ui.state.dialog).toBe("background");
    ui.openDialog(null);
    click(button("Layout"));
    click(row(/^Change layout/));
    expect(ui.state.dialog).toBe("layouts");
  });
});

describe("tooltips", () => {
  it("come from the toolbar itself, with the keys, after a short wait, so the row cannot clip them", async () => {
    const { session } = await setup();
    act(() => {
      const [id] = session.elements.insert([textBox({ x: 40, y: 40, w: 300, h: 60 }, "Words")]) as [string];
      session.select([id]);
    });
    const bold = button("Bold");
    fireEvent.mouseOver(bold);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toMatch(/^Bold \((Ctrl\+B|⌘B)\)$/);
    fireEvent.mouseDown(bold);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("the keyboard", () => {
  it("goes from button to button with Left and Right, skipping what is off", async () => {
    await setup();
    button("Select").focus();
    fireEvent.keyDown(button("Select"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(button("Text box"));
    fireEvent.keyDown(button("Text box"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(button("Select"));
    // The gallery's plus comes first in the group; before it, Undo and Redo are off, and so cannot be reached: the first button that can is the zoom.
    fireEvent.keyDown(button("Select"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(button("Insert gallery…"));
    fireEvent.keyDown(button("Insert gallery…"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(button("Zoom"));
  });

  it("opens a dropdown with the keyboard so that its first row is ready, and gives the focus back", async () => {
    await setup();
    button("Zoom").focus();
    // A click made by the keyboard has no detail.
    fireEvent.click(button("Zoom"));
    await nextFrame();
    expect(document.activeElement).toBe(row(/^Fit/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("50%"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button("Zoom"));
  });

  it("keeps a key pressed in an open dropdown from the editor's shortcuts", async () => {
    const { session } = await setup();
    act(() => void session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]));
    button("Zoom").focus();
    fireEvent.click(button("Zoom"));
    await nextFrame();
    const seen = vi.fn();
    document.body.addEventListener("keydown", seen);
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    document.body.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
    expect(session.slide.elements.some((e) => e.type === "shape")).toBe(true);
  });
});

describe("a window too narrow for the groups", () => {
  /** jsdom has no layout: gives the row a width and each group 150 pixels, and answers something to tell the bar when the width changes. */
  function withLayout() {
    const state = { client: 1000 };
    const watchers: (() => void)[] = [];
    const proto = HTMLElement.prototype;
    const saved = { client: Object.getOwnPropertyDescriptor(proto, "clientWidth"), offset: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => state.client });
    Object.defineProperty(proto, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.group ? 150 : 30;
      },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          watchers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    return {
      state,
      resize: (client: number) => {
        state.client = client;
        return act(async () => watchers.forEach((watch) => watch()));
      },
      restore() {
        vi.unstubAllGlobals();
        if (saved.client) Object.defineProperty(proto, "clientWidth", saved.client);
        else Reflect.deleteProperty(proto, "clientWidth");
        if (saved.offset) Object.defineProperty(proto, "offsetWidth", saved.offset);
        else Reflect.deleteProperty(proto, "offsetWidth");
      },
    };
  }

  it("sends the slide's own buttons into a more menu, and takes them back when there is room", async () => {
    const layout = withLayout();
    try {
      await setup();
      expect(screen.queryByRole("button", { name: "More tools" })).toBeNull();
      expect(button("Theme")).toBeTruthy();
      // Four groups of 150 do not fit in 500, with the room the bar keeps for its own button and the format options.
      await layout.resize(500);
      expect(screen.queryByRole("button", { name: "Theme" })).toBeNull();
      expect(button("Select")).toBeTruthy();
      expect(button("Format options")).toBeTruthy();
      click(button("More tools"));
      const more = screen.getByRole("dialog", { name: "More tools" });
      expect(within(more).getByRole("button", { name: "Theme" })).toBeTruthy();
      expect(within(more).queryByRole("button", { name: "Select" })).toBeNull();
      // A button in the menu works as it does in the bar.
      click(within(more).getByRole("button", { name: "Background" }));
      await layout.resize(1000);
      expect(screen.queryByRole("button", { name: "More tools" })).toBeNull();
      expect(button("Theme")).toBeTruthy();
    } finally {
      layout.restore();
    }
  });

  it("keeps the first groups and the format options in the bar however narrow it is, and goes from the last group first", async () => {
    const layout = withLayout();
    try {
      const { session } = await setup();
      act(() => {
        const [id] = session.elements.insert([textBox({ x: 40, y: 40, w: 300, h: 60 }, "Words")]) as [string];
        session.select([id]);
      });
      // History, zoom, font, text style, paragraph, shape style and arrange: seven groups of 150.
      await layout.resize(760);
      // Room for 760 - 16 - 30 = 714 minus the more button: four groups.
      expect(screen.queryByRole("button", { name: "Animate" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Fill colour" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Align" })).toBeNull();
      expect(button("Bold")).toBeTruthy();
      expect(button("Font")).toBeTruthy();
      await layout.resize(100);
      expect(button(/^Undo/)).toBeTruthy();
      expect(button("Zoom")).toBeTruthy();
      expect(button("Font")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
      expect(button("Format options")).toBeTruthy();
    } finally {
      layout.restore();
    }
  });
});
