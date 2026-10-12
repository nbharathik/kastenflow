// The keys that add things are written where the things are found: on the toolbar's buttons and in the Insert menu.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MenuBar } from "../menus/MenuBar.tsx";
import { bar, button, click, openEditor, row } from "../menus/testing.ts";
import { Toolbar } from "../toolbar/Toolbar.tsx";

afterEach(cleanup);

/** The keys written in a row of an open menu. */
const keysIn = (element: HTMLElement): string | undefined => element.querySelector("kbd")?.textContent ?? undefined;

describe("on the toolbar", () => {
  it("names the key in the tooltip of the text box button, which still arms the tool", async () => {
    const { session, ui } = await openEditor();
    render(<Toolbar session={session} ui={ui} />);
    expect(button("Text box").getAttribute("data-tip")).toBe("Text box (T)");
    click(button("Text box"));
    expect(session.state.tool).toBe("text");
    expect(session.slide.elements).toHaveLength(2);
  });

  it("names the key in the tooltip of a shape that has one, and only of those", async () => {
    const { session, ui } = await openEditor();
    render(<Toolbar session={session} ui={ui} />);
    click(button("Shape"));
    const grid = screen.getByRole("dialog", { name: "Shapes" });
    const tip = (name: string) => within(grid).getByRole("button", { name }).getAttribute("data-tip");
    expect(tip("Rectangle")).toBe("Rectangle (R)");
    expect(tip("Oval")).toBe("Oval (O)");
    expect(tip("Triangle")).toBe("Triangle");
  });
});

describe("in the Insert menu", () => {
  it("writes the key of the text box beside it, and still arms the tool", async () => {
    const { session, ui } = await openEditor();
    render(<MenuBar session={session} ui={ui} />);
    click(bar("Insert"));
    fireEvent.click(row(/^Text & content/));
    expect(keysIn(row(/^Text box/))).toBe("T");
    fireEvent.click(row(/^Text box/));
    expect(session.state.tool).toBe("text");
  });

  it("writes the keys of the shapes beside them", async () => {
    const { session, ui } = await openEditor();
    render(<MenuBar session={session} ui={ui} />);
    click(bar("Insert"));
    fireEvent.click(row(/^Shapes & lines/));
    fireEvent.click(row("Shapes"));
    expect(keysIn(row(/^Rectangle/))).toBe("R");
    expect(keysIn(row(/^Oval/))).toBe("O");
    expect(keysIn(row(/^Triangle/))).toBeUndefined();
  });

  it("writes the keys of the line and the arrow beside them", async () => {
    const { session, ui } = await openEditor();
    render(<MenuBar session={session} ui={ui} />);
    click(bar("Insert"));
    fireEvent.click(row(/^Shapes & lines/));
    fireEvent.click(row(/^Lines & arrows/));
    // "Lines & arrows" is the sub-menu's own row too; the one with a key is the line.
    expect([...screen.queryAllByRole("menuitem", { name: /^Line/ }), ...screen.queryAllByRole("menuitemcheckbox", { name: /^Line/ })].map(keysIn)).toContain("L");
    expect(keysIn(row(/^Arrow(?!s)/))).toBe("A");
    expect(keysIn(row(/^Elbow connector/))).toBeUndefined();
  });

  it("writes the key of the images drawer beside it", async () => {
    const { session, ui } = await openEditor();
    render(<MenuBar session={session} ui={ui} />);
    click(bar("Insert"));
    fireEvent.click(row(/^Media/));
    expect(keysIn(row(/^Image from the gallery/))).toBe("I");
    expect(keysIn(row(/^Image from computer/))).toBeUndefined();
  });
});
