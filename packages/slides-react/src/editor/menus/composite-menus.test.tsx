import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { textBox } from "../factory.ts";
import { ContextMenus } from "./ContextMenus.tsx";
import { MenuBar } from "./MenuBar.tsx";
import { bar, click, isDisabled, openEditor, row } from "./testing.ts";

afterEach(cleanup);

async function setup(withContext = false) {
  const editor = await openEditor();
  // A blank slide: the deck's first has a title and a subtitle of its own.
  act(() => void editor.session.slides.add({ layout: "blank" }));
  render(
    <>
      <MenuBar session={editor.session} ui={editor.ui} />
      {withContext ? <ContextMenus session={editor.session} ui={editor.ui} /> : null}
    </>,
  );
  return editor;
}

const rowNames = () => [...(screen.getAllByRole("menu")[0]?.querySelectorAll(":scope > button > .ks-menu-label") ?? [])].map((r) => r.textContent);

describe("the Insert menu", () => {
  /** What a group of the menu lists, by name. */
  const itemsOf = (group: RegExp): (string | null | undefined)[] => {
    fireEvent.click(row(group));
    const open = screen.getAllByRole("menu").at(-1)!;
    return [...open.querySelectorAll(":scope > button > .ks-menu-label")].map((r) => r.firstChild?.textContent);
  };

  it("lists the nine composites under their groups, and then the gallery", async () => {
    await setup();
    click(bar("Insert"));
    expect(rowNames().at(-2)).toMatch(/^Insert gallery/);
    expect(row(/^Insert gallery/).textContent).toMatch(/Ctrl\+\/|⌘\//);
    expect(itemsOf(/^Text & content/)).toEqual(["Text box", "Formula", "Code block", "Citation…"]);
    expect(itemsOf(/^Media/)).toEqual(["Image from computer…", "Image from the gallery…", "Video…"]);
    expect(itemsOf(/^Data/)).toEqual(["Table…", "Token probabilities"]);
    // A page of the vault only where the host has pages.
    expect(itemsOf(/^Pages & links/)).toEqual(["Web page…", "Insert link…"]);
    expect(itemsOf(/^Smart parts/)).toEqual(["Conversation", "Card grid", "Step label"]);
  });

  it("puts the composite on the slide when its row is picked", async () => {
    const { session } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Text & content/));
    fireEvent.click(row(/^Formula/));
    expect(session.slide.elements.map((e) => e.type)).toEqual(["math"]);
    expect(session.state.selection).toEqual([session.slide.elements[0]?.id]);
  });

  it("asks for an address for a page and a video, by opening a dialog", async () => {
    const { ui, session } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Pages & links/));
    fireEvent.click(row(/^Web page/));
    expect(ui.state.dialog).toBe("embed");
    click(bar("Insert"));
    fireEvent.click(row(/^Media/));
    fireEvent.click(row(/^Video/));
    expect(ui.state.dialog).toBe("video");
    expect(session.slide.elements).toHaveLength(0);
  });

  it("opens the gallery from its row", async () => {
    const { ui } = await setup();
    click(bar("Insert"));
    fireEvent.click(row(/^Insert gallery/));
    expect(ui.state.dialog).toBe("insert");
  });
});

describe("Ungroup to shapes", () => {
  const code = { type: "code", id: "", language: "python", code: "print(1)", x: 64, y: 148, w: 600, h: 260 } as unknown as Element;

  it("is in the Arrange menu, off until a composite that can be ungrouped is selected", async () => {
    const { session } = await setup();
    click(bar("Arrange"));
    expect(isDisabled(row(/^Ungroup to shapes/))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    let ids: string[] = [];
    act(() => {
      ids = session.elements.insert([code]);
    });
    click(bar("Arrange"));
    expect(isDisabled(row(/^Ungroup to shapes/))).toBe(false);
    fireEvent.click(row(/^Ungroup to shapes/));
    expect(session.slide.elements[0]?.type).toBe("group");
    expect(session.state.selection).toEqual(ids);
  });

  it("is in the menu of a right click on a composite, and not on other things", async () => {
    const { session, ui } = await setup(true);
    act(() => {
      session.elements.insert([textBox({ x: 10, y: 10, w: 100, h: 40 }, "Words")]);
      ui.openContextMenu({ kind: "element", x: 100, y: 100 });
    });
    expect(screen.queryByRole("menuitem", { name: "Ungroup to shapes" })).toBeNull();
    act(() => ui.openContextMenu(null));
    act(() => {
      session.elements.insert([code]);
      ui.openContextMenu({ kind: "element", x: 100, y: 100 });
    });
    expect(screen.getByRole("menuitem", { name: "Ungroup to shapes" })).toBeTruthy();
  });

  it("is not offered for a formula, which has no shapes to ungroup to", async () => {
    const { session, ui } = await setup(true);
    act(() => {
      session.elements.insert([{ type: "math", id: "", latex: "x", x: 10, y: 10, w: 200, h: 80 } as unknown as Element]);
      ui.openContextMenu({ kind: "element", x: 100, y: 100 });
    });
    expect(screen.queryByRole("menuitem", { name: "Ungroup to shapes" })).toBeNull();
  });
});
