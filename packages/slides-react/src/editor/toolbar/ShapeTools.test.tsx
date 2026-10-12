import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { line, shape, table, textBox } from "../factory.ts";
import { button, click, openEditor, row } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

afterEach(cleanup);

const queryButton = (name: string | RegExp) => screen.queryByRole("button", { name });

async function setup() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  /** Puts an element on the slide, as a person's action would, and answers its id. */
  const one = (element: Element) => {
    let id = "";
    act(() => {
      id = editor.session.elements.insert([element])[0]!;
    });
    return id;
  };
  const styleOf = (id: string) => editor.session.elements.find([id])[0]?.style;
  // The title slide's own placeholders are in the way of "nothing selected".
  act(() => editor.session.select([]));
  return { ...editor, one, styleOf };
}

describe("the shape controls", () => {
  it("are there only when the selection has a shape, a line, a connector, a text box or a picture, and the fill only where there is one", async () => {
    const { session, one } = await setup();
    expect(queryButton("Fill colour")).toBeNull();
    expect(queryButton("Border weight")).toBeNull();

    // A picture has a border, a shadow and an opacity, and no fill.
    const picture = one({ type: "image", id: "", src: "assets/x.png", x: 0, y: 0, w: 100, h: 100 } as Element);
    act(() => session.select([picture]));
    expect(queryButton("Fill colour")).toBeNull();
    for (const name of ["Border colour", "Border weight", "Shadow", "Opacity"]) expect(button(name), name).toBeTruthy();

    const grid = one(table(2, 2, { x: 10, y: 10, w: 200, h: 100 }));
    act(() => session.select([grid]));
    expect(queryButton("Fill colour")).toBeNull();
    expect(queryButton("Border colour")).toBeNull();

    const box = one(textBox({ x: 40, y: 40, w: 200, h: 60 }, "Words"));
    act(() => session.select([box]));
    for (const name of ["Fill colour", "Border colour", "Border weight", "Border dash"]) expect(button(name), name).toBeTruthy();
    // Arrowheads are for lines.
    expect(queryButton("Arrow start")).toBeNull();

    act(() => session.select([]));
    expect(queryButton("Fill colour")).toBeNull();
  });

  it("paint the fill from the palette, or take it off", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    act(() => session.select([id]));
    expect((button("Fill colour").querySelector(".ks-tb-bar") as HTMLElement).style.background).toMatch(/rgb|#/);

    click(button("Fill colour"));
    click(screen.getByRole("button", { name: "accent3" }));
    expect(styleOf(id)?.fill).toEqual({ color: "accent3" });
    expect(screen.queryByRole("dialog", { name: "Fill colour" })).toBeNull();

    click(button("Fill colour"));
    click(screen.getByRole("button", { name: "Transparent" }));
    expect(styleOf(id)?.fill ?? null).toBeNull();
    expect(button("Fill colour").querySelector(".ks-tb-bar")?.className).toContain("is-none");
  });

  it("keep the see-through of a fill when a colour is picked, and turn several shapes at once", async () => {
    const { session, one, styleOf } = await setup();
    const a = one(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    const b = one(shape("ellipse", { x: 200, y: 10, w: 100, h: 100 }));
    act(() => session.elements.style({ fill: { color: "accent1", alpha: 0.5 } }, [a]));
    act(() => session.elements.style({ fill: { color: "accent2" } }, [b]));
    act(() => session.select([a, b]));
    // They disagree on the fill, and the bar says so.
    expect(button("Fill colour").querySelector(".ks-tb-bar")?.className).toContain("is-mixed");
    click(button("Fill colour"));
    click(screen.getByRole("button", { name: "accent5" }));
    expect(styleOf(a)?.fill).toEqual({ color: "accent5", alpha: 0.5 });
    expect(styleOf(b)?.fill).toEqual({ color: "accent5" });
    expect(session.state.undoLabel).toBe("patch_elements");
  });

  it("set the border colour to a solid one, and take the border off", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    act(() => session.select([id]));
    // A new shape has a faint outline.
    expect(styleOf(id)?.stroke?.alpha).toBe(0.35);
    click(button("Border colour"));
    click(screen.getByRole("button", { name: "accent2" }));
    expect(styleOf(id)?.stroke).toEqual({ color: "accent2", width: 1 });
    click(button("Border colour"));
    click(screen.getByRole("button", { name: "Transparent" }));
    expect(styleOf(id)?.stroke ?? null).toBeNull();
  });

  it("set the border weight and dash, giving a box that had no border one to hold them", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(textBox({ x: 40, y: 40, w: 200, h: 60 }, "Words"));
    act(() => session.select([id]));
    click(button("Border weight"));
    expect(["1 px", "2 px", "3 px", "4 px", "6 px", "8 px", "12 px"].every((label) => row(label))).toBe(true);
    click(row("4 px"));
    expect(styleOf(id)?.stroke).toEqual({ color: "text1", width: 4 });
    click(button("Border weight"));
    expect(row("4 px").getAttribute("aria-checked")).toBe("true");
    keyEscape();

    click(button("Border dash"));
    expect(["Solid", "Dash", "Dot", "Dash-dot", "Long dash"].every((label) => row(label))).toBe(true);
    expect(row("Solid").getAttribute("aria-checked")).toBe("true");
    click(row("Dash-dot"));
    expect(styleOf(id)?.stroke).toEqual({ color: "text1", width: 4, dash: "dashDot" });
    click(button("Border dash"));
    click(row("Solid"));
    expect(styleOf(id)?.stroke?.dash ?? null).toBeNull();
  });

  it("keep the colour of a border that is there when its weight changes", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    act(() => session.elements.style({ stroke: { color: "accent4", width: 2 } }, [id]));
    act(() => session.select([id]));
    click(button("Border weight"));
    click(row("8 px"));
    expect(styleOf(id)?.stroke).toEqual({ color: "accent4", width: 8, alpha: 0.35 });
  });

  it("set the arrowheads of a line, and show them", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(line("straight", true, { x: 10, y: 10 }, { x: 200, y: 100 }));
    act(() => session.select([id]));
    // Lines have no fill, so there is no button for it.
    expect(queryButton("Fill colour")).toBeNull();
    click(button("Arrow end"));
    expect(["None", "Triangle", "Stealth", "Open", "Oval", "Diamond"].every((label) => row(label))).toBe(true);
    expect(row("Triangle").getAttribute("aria-checked")).toBe("true");
    click(row("Oval"));
    expect(styleOf(id)?.endArrow).toBe("oval");
    click(button("Arrow start"));
    expect(row("None").getAttribute("aria-checked")).toBe("true");
    click(row("Stealth"));
    expect(styleOf(id)?.startArrow).toBe("stealth");
    click(button("Arrow start"));
    click(row("None"));
    expect(styleOf(id)?.startArrow ?? null).toBeNull();
  });

  it("give a soft, medium or hard shadow, and take it off, checking the one in use", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    act(() => session.select([id]));
    click(button("Shadow"));
    expect(row("No shadow").getAttribute("aria-checked")).toBe("true");
    click(row("Medium"));
    expect(styleOf(id)?.shadow).toEqual({ color: "text1", blur: 16, dx: 4, dy: 8, alpha: 0.35 });
    expect(button("Shadow").getAttribute("aria-pressed")).toBe("true");
    click(button("Shadow"));
    expect(row("Medium").getAttribute("aria-checked")).toBe("true");
    click(row("No shadow"));
    expect(styleOf(id)?.shadow ?? null).toBeNull();
  });

  it("make what is selected see-through by a few steps, and back", async () => {
    const { session, one, styleOf } = await setup();
    const id = one(shape("rect", { x: 10, y: 10, w: 100, h: 100 }));
    act(() => session.select([id]));
    click(button("Opacity"));
    expect(row("100%").getAttribute("aria-checked")).toBe("true");
    click(row("50%"));
    expect(styleOf(id)?.opacity).toBe(0.5);
    click(button("Opacity"));
    expect(row("50%").getAttribute("aria-checked")).toBe("true");
    click(row("100%"));
    expect(styleOf(id)?.opacity ?? null).toBeNull();
  });

  it("leave an image alone when it is selected with a shape", async () => {
    const { session, one, styleOf } = await setup();
    const picture = one({ type: "image", id: "", src: "assets/x.png", x: 0, y: 0, w: 100, h: 100 } as Element);
    const box = one(shape("rect", { x: 200, y: 10, w: 100, h: 100 }));
    act(() => session.select([picture, box]));
    click(button("Fill colour"));
    click(screen.getByRole("button", { name: "accent2" }));
    expect(styleOf(box)?.fill).toEqual({ color: "accent2" });
    expect(styleOf(picture)?.fill).toBeUndefined();
  });
});

function keyEscape() {
  fireEvent.keyDown(document.body, { key: "Escape" });
}
