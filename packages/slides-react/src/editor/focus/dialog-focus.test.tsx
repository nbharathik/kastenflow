// A dialog opened from a menu row, closed again. The row (and the menu it was in) is gone by then, so the place the focus came from
// is gone too: the focus used to fall on the page and the editor's keys were dead until the slide was clicked.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { bar, click, nextFrame, openEditor, row } from "../menus/testing.ts";
import { Workspace } from "../SlidesEditor.tsx";
import { expectFocusOn } from "./testing.ts";

afterEach(cleanup);

async function setup() {
  const made = await openEditor();
  const [a] = made.session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
  const view = render(<Workspace session={made.session} ui={made.ui} />);
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  const has = () => made.session.slide.elements.some((element) => element.id === a);
  return { ...made, ...view, a, stage, has, root: view.container.firstElementChild as HTMLElement };
}

describe("closing a dialog whose opener is gone", () => {
  it("leaves the focus on the slide, and the keys work, when Escape closes it", async () => {
    const { session, ui, root, stage, a, has } = await setup();
    // An opener that goes with the dialog's arrival, as a menu row does.
    const opener = document.createElement("button");
    root.append(opener);
    opener.focus();
    act(() => ui.openDialog("shortcuts"));
    opener.remove();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(ui.state.dialog).toBeNull();
    expectFocusOn(stage());
    act(() => session.select([a]));
    fireEvent.keyDown(document.activeElement!, { key: "Delete", code: "Delete" });
    expect(has()).toBe(false);
  });

  it("returns to the opener when it is still there", async () => {
    const { ui, root } = await setup();
    const opener = document.createElement("button");
    root.append(opener);
    opener.focus();
    act(() => ui.openDialog("shortcuts"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expectFocusOn(opener);
  });

  it("does not take the focus from a place the closing sent it to", async () => {
    const { ui, root } = await setup();
    const elsewhere = document.createElement("button");
    root.append(elsewhere);
    act(() => ui.openDialog("shortcuts"));
    act(() => {
      ui.openDialog(null);
      elsewhere.focus();
    });
    expectFocusOn(elsewhere);
  });

  it("goes to the slide when the dialog was opened with nothing focused", async () => {
    const { ui, stage } = await setup();
    expectFocusOn(document.body);
    act(() => ui.openDialog("shortcuts"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expectFocusOn(stage());
  });
});

describe("a dialog opened from a row of the menu bar", () => {
  it("gives the keys back to the slide when it is cancelled, and when Escape closes it", async () => {
    const { ui, session, stage, a, has } = await setup();
    act(() => session.select([a]));
    click(bar("File"));
    await nextFrame();
    click(row(/^Page setup/));
    expect(ui.state.dialog).toBe("page");
    const dialog = screen.getByRole("dialog", { name: /page/i });
    click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(ui.state.dialog).toBeNull();
    expectFocusOn(stage());
    click(bar("File"));
    await nextFrame();
    click(row(/^Page setup/));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(ui.state.dialog).toBeNull();
    expectFocusOn(stage());
    fireEvent.keyDown(document.activeElement!, { key: "Delete", code: "Delete" });
    expect(has()).toBe(false);
  });
});
