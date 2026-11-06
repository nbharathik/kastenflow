import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCommand } from "../commands/index.ts";
import { styleNames } from "../commands/text-style.ts";
import { textBox } from "../factory.ts";
import { button, click, fakeTextBox, nextFrame, openEditor, row } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function withBox() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  const [id] = editor.session.elements.insert([textBox({ x: 40, y: 40, w: 400, h: 80 }, "Hello world")]) as [string];
  act(() => editor.session.select([id]));
  const now = () => editor.session.elements.find([id])[0];
  return { ...editor, id, now };
}

const paragraphs = (element: Element | undefined) => (element && (element.type === "text" || element.type === "shape") ? (element.text?.paragraphs ?? []) : []);

async function open() {
  click(button("Text style"));
  await nextFrame();
}

describe("the text style list", () => {
  it("is not in the bar with nothing to format, and shows the style the box is set in", async () => {
    const editor = await openEditor();
    render(<Toolbar session={editor.session} ui={editor.ui} />);
    act(() => editor.session.select([]));
    expect(screen.queryByRole("button", { name: "Text style" })).toBeNull();
    await withBoxIn(editor);
    expect(button("Text style").textContent).toContain("Body");
  });

  it("lists the styles of the theme in order, each in its own look", async () => {
    const { session } = await withBox();
    await open();
    const names = styleNames(session.deck.theme);
    expect(names.slice(0, 4)).toEqual(["title", "subtitle", "display", "body"]);
    for (const label of ["Title", "Subtitle", "Body", "Caption", "Quote"]) expect(row(new RegExp(`^${label}$`)), label).toBeTruthy();
    // The title is drawn bold, the quote slanted: the sample beside each name says how the style looks.
    const title = row(/^Title$/).querySelector<HTMLElement>(".ks-style-sample")!;
    expect(title.style.fontWeight).toBe("700");
    expect(row(/^Quote$/).querySelector<HTMLElement>(".ks-style-sample")!.style.fontStyle).toBe("italic");
    expect(row(/^Body$/).getAttribute("aria-checked")).toBe("true");
  });

  it("sets every paragraph of the box in the style chosen, as one step of undo, and shows it", async () => {
    const { session, id, now } = await withBox();
    act(() => session.elements.setText(id, { paragraphs: [{ runs: [{ t: "One" }] }, { runs: [{ t: "Two" }] }] }));
    await open();
    click(row(/^Caption$/));
    expect(paragraphs(now()).map((p) => p.style)).toEqual(["caption", "caption"]);
    expect(button("Text style").textContent).toContain("Caption");
    act(() => session.undo());
    expect(paragraphs(now()).map((p) => p.style)).toEqual([undefined, undefined]);
    expect(button("Text style").textContent).toContain("Body");
  });

  it("says Mixed where the paragraphs are set in different styles", async () => {
    const { session, id } = await withBox();
    act(() => session.elements.setText(id, { paragraphs: [{ runs: [{ t: "One" }], style: "title" }, { runs: [{ t: "Two" }] }] }));
    expect(button("Text style").textContent).toContain("Mixed");
  });

  it("leaves no style on a paragraph put back in the style of its box", async () => {
    const { now } = await withBox();
    await open();
    click(row(/^Quote$/));
    expect(paragraphs(now())[0]?.style).toBe("quote");
    await open();
    click(row(/^Body$/));
    expect(paragraphs(now())[0]?.style).toBeUndefined();
  });

  it("goes to the open text box when words are being edited", async () => {
    const { ui } = await withBox();
    const box = fakeTextBox();
    act(() => ui.setText(box));
    await open();
    click(row(/^Subtitle$/));
    expect(box.setParagraphStyle).toHaveBeenCalledWith("subtitle");
  });

  it("has a command for each of the standard styles, which the palette and keys can reach", async () => {
    const { session, ui, now } = await withBox();
    await act(async () => runCommand("text.style-title", { session, ui }));
    expect(paragraphs(now())[0]?.style).toBe("title");
  });
});

async function withBoxIn(editor: Awaited<ReturnType<typeof openEditor>>) {
  const [id] = editor.session.elements.insert([textBox({ x: 40, y: 40, w: 400, h: 80 }, "Hello")]) as [string];
  act(() => editor.session.select([id]));
}
