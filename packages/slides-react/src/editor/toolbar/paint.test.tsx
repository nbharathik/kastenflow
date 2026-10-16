import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { line, shape, textBox } from "../factory.ts";
import { click, fakeTextBox, openEditor } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

afterEach(cleanup);

const brush = () => screen.getByRole("button", { name: "Paint format" });

async function setup() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  const one = (element: Element) => {
    let id = "";
    act(() => {
      id = editor.session.elements.insert([element])[0]!;
    });
    return id;
  };
  const get = (id: string) => editor.session.elements.find([id])[0]!;
  const runs = (id: string) => {
    const element = get(id);
    return element.type === "shape" || element.type === "text" ? (element.text?.paragraphs[0]?.runs ?? []) : [];
  };
  const select = (...ids: string[]) => act(() => editor.session.select(ids));
  return { ...editor, one, get, runs, select };
}

/** A shape saying "Model", bold, in accent 2 at 30 points, filled in accent 3 with round corners. */
function fancy(): Element {
  return {
    ...shape("roundRect", { x: 10, y: 10, w: 200, h: 100 }),
    style: { fill: { color: "accent3" }, stroke: { color: "accent4", width: 3 }, radius: 12 },
    text: { paragraphs: [{ runs: [{ t: "Model", b: true, i: true, color: "accent2", size: 30 }], align: "center" }], valign: "middle" },
  } as Element;
}

const plain = (): Element => ({ ...shape("rect", { x: 300, y: 10, w: 200, h: 100 }), text: { paragraphs: [{ runs: [{ t: "Host" }], align: "center" }], valign: "middle" } }) as Element;

describe("the paint format brush", () => {
  it("is off with nothing to copy, and picks up the look of the selection", async () => {
    const { session, ui, one, select } = await setup();
    select();
    expect((brush() as HTMLButtonElement).disabled).toBe(true);
    const a = one(fancy());
    select(a);
    expect((brush() as HTMLButtonElement).disabled).toBe(false);
    click(brush());
    expect(ui.state.paint).toEqual({
      run: { b: true, i: true, u: false, s: false, color: "accent2", highlight: null, size: 30, script: null, smallCaps: false, allCaps: false, spacing: null },
      paragraph: { align: "center", lineSpacing: null, spaceBefore: null, spaceAfter: null, list: null, listStyle: null, bulletColor: null, bulletSize: null },
      style: { fill: { color: "accent3" }, stroke: { color: "accent4", width: 3 }, radius: 12 },
    });
    expect(brush().getAttribute("aria-pressed")).toBe("true");
    // Picking it up changes nothing.
    expect(session.state.canUndo).toBe(true);
    expect(session.state.undoLabel).toBe("add_elements");
  });

  it("lays that look on the next element clicked, once, as one step of undo", async () => {
    const { session, ui, one, get, runs, select } = await setup();
    const a = one(fancy());
    const b = one(plain());
    select(a);
    click(brush());
    select(b);
    expect(ui.state.paint).toBeNull();
    expect(brush().getAttribute("aria-pressed")).toBe("false");
    expect(runs(b)).toEqual([{ t: "Host", b: true, i: true, color: "accent2", size: 30 }]);
    expect(get(b).style).toEqual({ fill: { color: "accent3" }, stroke: { color: "accent4", width: 3 }, radius: 12 });
    // The source is as it was, and the words are the target's own.
    expect(runs(a)[0]).toMatchObject({ t: "Model", b: true });
    expect(session.state.undoLabel).toBe("patch_elements");
    act(() => session.undo());
    expect(runs(b)).toEqual([{ t: "Host" }]);
    expect(get(b).style?.radius).toBeUndefined();
    expect(session.state.undoLabel).toBe("add_elements");
  });

  it("does nothing when the same element is clicked again, and stays in hand for the next", async () => {
    const { ui, one, runs, select } = await setup();
    const a = one(fancy());
    const b = one(plain());
    select(a);
    click(brush());
    select(a);
    expect(ui.state.paint).not.toBeNull();
    select();
    expect(ui.state.paint).not.toBeNull();
    select(b);
    expect(ui.state.paint).toBeNull();
    expect(runs(b)[0]?.b).toBe(true);
  });

  it("puts down what the source did not have: no bold, the text style's colour and size", async () => {
    const { one, runs, select } = await setup();
    const source = one(plain());
    const target = one(fancy());
    select(source);
    click(brush());
    select(target);
    expect(runs(target)).toEqual([{ t: "Model" }]);
  });

  it("is put away by a second click on the button, and by Escape, without painting anything", async () => {
    const { ui, session, one, runs, select } = await setup();
    const a = one(fancy());
    const b = one(plain());
    select(a);
    click(brush());
    click(brush());
    expect(ui.state.paint).toBeNull();
    select(b);
    expect(runs(b)).toEqual([{ t: "Host" }]);

    select(a);
    click(brush());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(ui.state.paint).toBeNull();
    select(b);
    expect(runs(b)).toEqual([{ t: "Host" }]);
    expect(session.state.undoLabel).toBe("add_elements");
  });

  it("copies from the text being edited, then paints the next thing clicked", async () => {
    const { session, ui, one, runs, select, get } = await setup();
    const a = one(fancy());
    const b = one(plain());
    select(a);
    session.startEditing(a);
    act(() => ui.setText(fakeTextBox({ bold: true, italic: false, color: "accent5", size: 18 })));
    click(brush());
    expect(ui.state.paint?.run).toEqual({ b: true, i: false, u: false, s: false, color: "accent5", highlight: null, size: 18, script: null, smallCaps: false, allCaps: false, spacing: null });
    // Leaving the box changes nothing yet: the brush waits for another element.
    act(() => {
      ui.setText(null);
      session.stopEditing();
    });
    expect(ui.state.paint).not.toBeNull();
    select(b);
    expect(runs(b)).toEqual([{ t: "Host", b: true, color: "accent5", size: 18 }]);
    expect(get(b).style?.radius).toBe(12);
  });

  it("carries how paragraphs are set and the newer looks of words: raised words, capitals, letter spacing, a list with its marker", async () => {
    const { ui, one, get, select } = await setup();
    const source = one({
      ...shape("rect", { x: 10, y: 10, w: 200, h: 100 }),
      text: {
        paragraphs: [
          { runs: [{ t: "Raised", script: "super", smallCaps: true, spacing: 2 }], list: "number", listStyle: "upperRoman", bulletSize: 1.5, bulletColor: "accent2", lineSpacing: 1.5, spaceAfter: 12, align: "right" },
        ],
      },
    } as Element);
    const target = one({
      ...shape("rect", { x: 300, y: 10, w: 200, h: 100 }),
      text: { paragraphs: [{ runs: [{ t: "One", allCaps: true }] }, { runs: [{ t: "Two" }], list: "bullet", level: 1 }] },
    } as Element);
    select(source);
    click(brush());
    expect(ui.state.paint?.paragraph).toMatchObject({ list: "number", listStyle: "upperRoman", bulletSize: 1.5, bulletColor: "accent2", lineSpacing: 1.5, spaceAfter: 12, align: "right" });
    select(target);
    const text = get(target).type === "shape" ? (get(target) as Extract<Element, { type: "shape" }>).text : undefined;
    expect(text?.paragraphs.map((p) => p.runs[0])).toEqual([
      { t: "One", script: "super", smallCaps: true, spacing: 2 },
      { t: "Two", script: "super", smallCaps: true, spacing: 2 },
    ]);
    expect(text?.paragraphs.map((p) => [p.list, p.listStyle, p.bulletSize, p.bulletColor, p.lineSpacing, p.spaceAfter, p.align])).toEqual([
      ["number", "upperRoman", 1.5, "accent2", 1.5, 12, "right"],
      ["number", "upperRoman", 1.5, "accent2", 1.5, 12, "right"],
    ]);
  });

  it("gives a shape's look to a line without the shape's fill, and arrowheads only to lines", async () => {
    const { one, get, select } = await setup();
    const arrow = one(line("straight", true, { x: 10, y: 300 }, { x: 200, y: 300 }));
    const box = one(fancy());
    const target = one(line("straight", false, { x: 10, y: 400 }, { x: 200, y: 400 }));
    select(arrow);
    click(brush());
    select(box);
    // The arrow's look went onto the shape: its outline, not an arrowhead.
    expect(get(box).style?.endArrow).toBeUndefined();
    expect(get(box).style?.stroke).toEqual({ color: "text1", width: 2 });
    select(target);
    click(brush());
    select(arrow);
    expect(get(arrow).style?.endArrow).toBeUndefined();
  });

  it("gives the look of a text box to a line and back without touching its words", async () => {
    const { one, get, runs, select } = await setup();
    const words = one(textBox({ x: 10, y: 10, w: 200, h: 50 }, "Words"));
    const target = one(line("straight", true, { x: 10, y: 300 }, { x: 200, y: 300 }));
    select(words);
    click(brush());
    select(target);
    expect(get(target).style?.endArrow).toBeUndefined();
    expect(runs(words)).toEqual([{ t: "Words" }]);
  });
});
