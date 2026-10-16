// The focus audit. Every way the editor's keys used to go dead is one test here: something takes the focus, goes away, and the focus must
// land inside the editor (not on the page) with Delete, Ctrl+Z, Ctrl+C and Ctrl+V working. The numbers order the ways the keys went dead.
// The host's side (the sidebar, tabs and panes, its overlays, the native web view) is played by the events it causes in the page:
// a focus that falls to the body, a window that comes back, a `focusKey` that changes.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { openPresentation } from "../../present/open.tsx";
import { viewOfHandle } from "../../text/handle.ts";
import { installDomShims } from "../../text/test-support.ts";
import { forget } from "../clipboard/store.ts";
import { table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { bar, button, click, nextFrame, row } from "../menus/testing.ts";
import { SlidesEditor, Workspace } from "../SlidesEditor.tsx";
import { selectionAt } from "../table/cells.ts";
import type { DialogName } from "../ui-state.ts";
import { audit, installAuditEnvironment, key, keysAct, openerThatGoes } from "./audit-kit.tsx";
import { expectFocusIn, expectFocusOn } from "./testing.ts";

beforeAll(installAuditEnvironment);

afterEach(() => {
  cleanup();
  forget();
  document.body.replaceChildren();
});

describe("1. opening a deck", () => {
  it("gives the slide the keys when the editor is shown with autoFocus, as the sidebar, the home page, the switcher and a link do", async () => {
    const engine = await newDeck("Talk");
    engine.apply("add_slide", { layout: "title-body", content: { title: "Two", body: "Point" } });
    const text = engine.save();
    const view = render(<SlidesEditor text={text} host={new MemoryHost()} autoFocus />);
    await waitFor(() => expect(view.container.querySelector(".ks-stage")).not.toBeNull());
    // The editor takes the keys once it has painted and its effects have run.
    await waitFor(() => expectFocusOn(view.container.querySelector(".ks-stage")));
    expectFocusIn(view.container.querySelector<HTMLElement>(".ks-editor"));
  });

  it("works the same for a deck made from sections of a page: the editor is new and autoFocus is all it needs", async () => {
    const made = await audit({ autoFocus: true });
    expectFocusOn(made.stage());
    keysAct(made);
  });
});

describe("2. coming back to the deck tab, or changing panes of a split", () => {
  it("takes the keys when the host changes focusKey, and when a key falls on the page of the pane in use", async () => {
    const made = await audit();
    const draw = (focusKey: unknown, route?: () => boolean) => made.rerender(<Workspace session={made.session} ui={made.ui} focusKey={focusKey} routeOrphanKeys={route} />);
    draw(1);
    expectFocusOn(made.stage());
    keysAct(made);
    // The other pane was used; this pane's page lost the focus; the host says it is in use again.
    (document.activeElement as HTMLElement).blur();
    draw(2, () => true);
    expectFocusOn(made.stage());
    (document.activeElement as HTMLElement).blur();
    keysAct(made);
  });
});

const DIALOGS: DialogName[] = [
  "find",
  "layouts",
  "theme",
  "background",
  "shortcuts",
  "insert",
  "embed",
  "video",
  "table",
  "link",
  "export",
  "png",
  "about",
  "import",
  "lint",
  "citation",
  "page",
  "insert-page",
  "layout-save",
  "layouts-manage",
  "template-save",
  "template-apply",
  "import-layouts",
];

describe("3. closing a dialog", () => {
  it("by Escape, whether or not the opener is still there, for every dialog", { timeout: 120_000 }, async () => {
    const made = await audit();
    let shown = 0;
    for (const name of DIALOGS) {
      for (const goes of [true, false]) {
        const opener = openerThatGoes(made.root);
        act(() => made.ui.openDialog(name));
        // A dialog that has nothing to show this host (it asks the host for a page and closes itself) is not one to close.
        if (screen.queryAllByRole("dialog").length === 0) {
          act(() => made.ui.openDialog(null));
          opener.drop();
          continue;
        }
        if (!goes) shown += 1;
        if (goes) opener.drop();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        expect(made.ui.state.dialog, `${name} closed by Escape`).toBeNull();
        expect(made.root.contains(document.activeElement), `${name}${goes ? " (opener gone)" : ""}: the focus is in the editor`).toBe(true);
        // With the opener still there, the keys went back to it.
        if (!goes) expect(document.activeElement === opener.element, `${name}: the focus is back on the opener`).toBe(true);
        made.stage().focus();
        if (!goes) opener.drop();
      }
    }
    expect(shown).toBeGreaterThanOrEqual(DIALOGS.length - 2);
    keysAct(made);
  });

  it("by its Cancel, Close or Done button, with the opener gone", { timeout: 120_000 }, async () => {
    const made = await audit();
    let closed = 0;
    for (const name of DIALOGS) {
      const opener = openerThatGoes(made.root);
      act(() => made.ui.openDialog(name));
      opener.drop();
      const finish = screen.queryAllByRole("button").find((b) => b.closest(".ks-dialog") && /^(cancel|close|done)$/i.test(b.textContent?.trim() ?? ""));
      if (!finish) {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        act(() => made.ui.openDialog(null));
        continue;
      }
      click(finish);
      expect(made.ui.state.dialog, `${name} closed by ${finish.textContent}`).toBeNull();
      expect(made.root.contains(document.activeElement), `${name}: the focus is in the editor`).toBe(true);
      closed += 1;
    }
    expect(closed).toBeGreaterThan(8);
    keysAct(made);
  });

  it("by its confirming button, which does the work and closes", async () => {
    const made = await audit();
    // Layouts: Done. Page setup: its OK does what was asked.
    const opener = openerThatGoes(made.root);
    act(() => made.ui.openDialog("page"));
    opener.drop();
    const dialog = screen.getByRole("dialog", { name: /page/i });
    const ok = within(dialog).getAllByRole("button").find((b) => /^(ok|apply|done|set|save)/i.test(b.textContent?.trim() ?? ""));
    expect(ok).toBeTruthy();
    click(ok!);
    expect(made.ui.state.dialog).toBeNull();
    expectFocusIn(made.root);
    keysAct(made);
  });
});

describe("4. closing the context menu", () => {
  it("by Escape, by a press outside, and by running a row", async () => {
    const made = await audit();
    made.stage().focus();
    act(() => made.ui.openContextMenu({ kind: "canvas", x: 40, y: 40 }));
    await nextFrame();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(made.ui.state.contextMenu).toBeNull();
    expectFocusOn(made.stage());

    act(() => made.ui.openContextMenu({ kind: "canvas", x: 40, y: 40 }));
    await nextFrame();
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(made.ui.state.contextMenu).toBeNull();
    expectFocusIn(made.root);

    act(() => made.ui.openContextMenu({ kind: "canvas", x: 40, y: 40 }));
    await nextFrame();
    click(row(/^Select all/));
    expect(made.ui.state.contextMenu).toBeNull();
    expectFocusIn(made.root);
    keysAct(made);
  });

  it("on a slide of the filmstrip, when the row it was opened from is deleted by the menu", async () => {
    const made = await audit();
    made.list().focus();
    act(() => made.ui.openContextMenu({ kind: "slide", x: 40, y: 40 }));
    await nextFrame();
    click(row(/^Delete slide/));
    expect(made.session.deck.slides).toHaveLength(2);
    expectFocusIn(made.root);
    keysAct(made);
  });
});

describe("5. closing a toolbar dropdown or popover", () => {
  it("a dropdown, by Escape, by a press outside and by running a row", async () => {
    const made = await audit();
    for (const how of ["escape", "outside", "row"] as const) {
      made.stage().focus();
      click(button("Zoom"));
      await nextFrame();
      if (how === "escape") fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      else if (how === "outside") fireEvent.pointerDown(document.body, { button: 0 });
      else click(row("50%"));
      expect(screen.queryByRole("menu"), how).toBeNull();
      expectFocusIn(made.root);
    }
    keysAct(made);
  });

  it("the colour picker of a selected block, by Escape and by choosing a colour", async () => {
    const made = await audit();
    act(() => made.session.select([made.a]));
    made.stage().focus();
    click(button(/^Fill colou?r/));
    await nextFrame();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expectFocusIn(made.root);
    click(button(/^Fill colou?r/));
    await nextFrame();
    fireEvent.pointerDown(document.body, { button: 0 });
    expectFocusIn(made.root);
    keysAct(made);
  });

  it("the menus of the menu bar, by Escape and by running a row", async () => {
    const made = await audit();
    for (const name of ["Format", "Insert", "View"]) {
      made.stage().focus();
      click(bar(name));
      await nextFrame();
      expect(screen.queryByRole("menu"), name).not.toBeNull();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      expect(screen.queryByRole("menu"), name).toBeNull();
      expectFocusIn(made.root);
    }
    click(bar("View"));
    await nextFrame();
    click(row(/^Snap to guides/));
    expect(screen.queryByRole("menu")).toBeNull();
    expectFocusIn(made.root);
    keysAct(made);
  });
});

describe("6. ending a text edit", () => {
  it("leaves the keys with the slide when the box closes", async () => {
    const made = await audit();
    act(() => made.session.select([made.label]));
    act(() => made.session.startEditing(made.label));
    await nextFrame();
    act(() => made.session.stopEditing());
    await nextFrame();
    expectFocusIn(made.root);
    expect(made.root.contains(document.activeElement)).toBe(true);
    keysAct(made);
  });

  it("ends a cell edit the same way: the keys are with the slide whether the cell was written, left by Escape, or left for another cell", async () => {
    installDomShims();
    const made = await audit();
    const [grid] = made.session.elements.insert([table(2, 2, { x: 120, y: 300, w: 200, h: 80 })]) as [string];
    const open = async (row: number, col: number) => {
      act(() => made.session.startEditingCell(selectionAt(grid, { row, col })));
      await nextFrame();
      expect(made.q(".ks-cell-layer"), "the cell is open").not.toBeNull();
    };
    /** A key in the cell's own editor, the one the commands reach. */
    const inCell = (init: KeyboardEventInit & { keyCode: number }) => fireEvent.keyDown(viewOfHandle(made.ui.state.text!)!.dom, init);
    // Written by stopEditing, as a click on the slide's grey does it.
    await open(0, 0);
    act(() => made.session.stopEditing());
    await nextFrame();
    expect(made.root.querySelector(".ks-cell-layer")).toBeNull();
    expectFocusIn(made.root);
    keysAct(made);
    // Left by Escape in the cell's own editor, which discards what was typed.
    await open(1, 1);
    inCell({ key: "Escape", keyCode: 27 });
    await nextFrame();
    expect(made.session.state.editing).toBeNull();
    expect(made.root.querySelector(".ks-cell-layer")).toBeNull();
    expectFocusIn(made.root);
    keysAct(made);
    // Moved on by Tab to the next cell, then ended: the new layer gives the keys back as the first did.
    await open(0, 1);
    inCell({ key: "Tab", keyCode: 9 });
    await nextFrame();
    expect(made.session.state.cells).toEqual(selectionAt(grid, { row: 1, col: 0 }));
    act(() => made.session.stopEditing());
    await nextFrame();
    expectFocusIn(made.root);
    keysAct(made);
  });
});

describe("7. deleting the last selected element, or a slide with the focus on its thumbnail", () => {
  it("keeps the keys on the slide after the last block is deleted", async () => {
    const made = await audit();
    made.stage().focus();
    act(() => made.session.select([made.a, made.label]));
    key({ key: "Delete", code: "Delete" });
    expect(made.session.slide.elements.some((e) => e.id === made.a)).toBe(false);
    expectFocusOn(made.stage());
    key({ key: "z", code: "KeyZ", ctrlKey: true });
    keysAct(made);
  });

  it("keeps the keys in the filmstrip after its slide is deleted", async () => {
    const made = await audit();
    made.list().focus();
    key({ key: "Delete", code: "Delete" });
    expect(made.session.deck.slides).toHaveLength(2);
    expectFocusIn(made.root);
    key({ key: "z", code: "KeyZ", ctrlKey: true });
    expect(made.session.deck.slides).toHaveLength(3);
    keysAct(made);
  });
});

describe("8. ending a presentation", () => {
  it("returns the keys to the editor when the presentation closes, whatever it was started from", async () => {
    const made = await audit();
    for (const from of ["slide", "gone", "nothing"] as const) {
      const opener = from === "gone" ? openerThatGoes(made.root) : null;
      if (from === "slide") made.stage().focus();
      if (from === "nothing") (document.activeElement as HTMLElement | null)?.blur();
      const show = openPresentation({ deck: made.session.deck, start: 0, imageUrl: () => undefined });
      await act(async () => void (await new Promise((done) => setTimeout(done, 40))));
      opener?.drop();
      expect(document.querySelector(".ks-show-root")).not.toBeNull();
      await act(async () => {
        show.close();
        await Promise.resolve();
      });
      expect(document.querySelector(".ks-show-root"), from).toBeNull();
      expect(made.root.contains(document.activeElement), `presentation started from ${from}: the focus is in the editor`).toBe(true);
    }
    keysAct(made);
  });
});

describe("9. closing the host's overlays (palette, page picker, confirm dialog, toast action, peek)", () => {
  it("lets the next key reach the editor once the overlay that held the focus is gone", async () => {
    const made = await audit({ route: true });
    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    document.body.append(overlay);
    overlay.focus();
    expectFocusOn(overlay);
    overlay.remove();
    expectFocusOn(document.body);
    keysAct(made);
  });
});

describe("10. the window gets the focus back", () => {
  it("gives the slide the keys, and the first key does not have to find it", async () => {
    const made = await audit({ route: true });
    made.stage().focus();
    fireEvent.blur(window);
    // The page's focus is lost when the window returns, as WebView2 does after another window or a native view had it.
    (document.activeElement as HTMLElement).blur();
    fireEvent.focus(window);
    expectFocusOn(made.stage());
    keysAct(made);
  });

  it("and the presenter's window closing is the same: this window is left with nothing focused", async () => {
    const made = await audit({ route: true });
    expectFocusOn(document.body);
    fireEvent.focus(window);
    expectFocusOn(made.stage());
    keysAct(made);
  });
});

describe("11. clicking the deck after a native web view had the focus", () => {
  it("takes the keys with the first press on the slide's grey, though the page's focus was on the body all the time", async () => {
    const made = await audit();
    expectFocusOn(document.body);
    fireEvent.pointerDown(made.stage(), { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(made.stage(), { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    expectFocusOn(made.stage());
    keysAct(made);
  });

  it("and with the first press on a block of the slide", async () => {
    const made = await audit();
    const page = made.q(".ks-page");
    fireEvent.pointerDown(page, { button: 0, clientX: 750, clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(page, { button: 0, clientX: 750, clientY: 450, pointerId: 1 });
    expectFocusOn(made.stage());
    keysAct(made);
  });
});
