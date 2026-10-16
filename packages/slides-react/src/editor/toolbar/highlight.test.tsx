// The highlight colour in the toolbar and as commands: the same colour behind the words of a selected box, or of the words selected in an
// open text box.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../commands/index.ts";
import { MARKER } from "../commands/format.ts";
import { textBox } from "../factory.ts";
import { button, click, fakeTextBox, openEditor } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const runsOf = (element: Element | undefined) => (element && (element.type === "text" || element.type === "shape") ? (element.text?.paragraphs[0]?.runs ?? []) : []);

async function withBox() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  const [id] = editor.session.elements.insert([textBox({ x: 40, y: 40, w: 400, h: 80 }, "Hello world")]) as [string];
  const now = () => editor.session.elements.find([id])[0];
  return { ...editor, id, now, ctx: { session: editor.session, ui: editor.ui } };
}

describe("the highlight colour button", () => {
  it("is next to the text colour, with a None choice first", async () => {
    await withBox();
    click(button("Highlight colour"));
    expect(within(screen.getByRole("dialog", { name: "Highlight colour" })).getByRole("button", { name: "None" })).toBeTruthy();
  });

  it("puts a colour behind all the words of a selected box, and None takes it away", async () => {
    const { now } = await withBox();
    click(button("Highlight colour"));
    click(screen.getByRole("button", { name: "accent3" }));
    expect(runsOf(now()).every((r) => r.highlight === "accent3")).toBe(true);
    // The bar under the button is the colour in use.
    expect((button("Highlight colour").querySelector(".ks-tb-bar") as HTMLElement).style.background).toMatch(/rgb|#/);
    click(button("Highlight colour"));
    click(screen.getByRole("button", { name: "None" }));
    expect(runsOf(now()).some((r) => r.highlight)).toBe(false);
  });

  it("is in one step of undo", async () => {
    const { session, now } = await withBox();
    click(button("Highlight colour"));
    click(screen.getByRole("button", { name: "accent3" }));
    act(() => session.undo());
    expect(runsOf(now()).some((r) => r.highlight)).toBe(false);
  });

  it("goes to the open text box, for the words selected there", async () => {
    const { ui, now } = await withBox();
    const box = fakeTextBox();
    act(() => ui.setText(box));
    click(button("Highlight colour"));
    click(screen.getByRole("button", { name: "accent3" }));
    expect((box.setHighlight as ReturnType<typeof vi.fn>).mock.calls).toEqual([["accent3"]]);
    // The words of the box in the deck are the editor's to write when it closes.
    expect(runsOf(now()).some((r) => r.highlight)).toBe(false);
  });
});

describe("the highlight commands", () => {
  it("Highlight puts the marker's yellow behind the words of a selected box, and takes it off when all of them have it", async () => {
    const { session, id, now, ctx } = await withBox();
    act(() => session.select([id]));
    await runCommand("text.highlight", ctx);
    expect(runsOf(now()).every((r) => r.highlight === MARKER)).toBe(true);
    await runCommand("text.highlight", ctx);
    expect(runsOf(now()).some((r) => r.highlight)).toBe(false);
  });

  it("Remove highlight takes any colour away", async () => {
    const { session, id, now, ctx } = await withBox();
    act(() => session.select([id]));
    act(() => session.text.setRun("highlight", "accent2"));
    expect(runsOf(now()).every((r) => r.highlight === "accent2")).toBe(true);
    await runCommand("text.highlight-none", ctx);
    expect(runsOf(now()).some((r) => r.highlight)).toBe(false);
  });

  it("are not available with nothing selected", async () => {
    const { session, ctx } = await withBox();
    act(() => session.select([]));
    const before = session.state.revision;
    await runCommand("text.highlight", ctx);
    expect(session.state.revision).toBe(before);
  });

  it("show the colour the selected boxes agree on, and mixed where they do not", async () => {
    const { session, id, ctx } = await withBox();
    const [other] = session.elements.insert([textBox({ x: 40, y: 200, w: 400, h: 80 }, "Other")]) as [string];
    act(() => session.select([id]));
    act(() => session.text.setRun("highlight", "accent2"));
    expect(session.text.state([id]).highlight).toBe("accent2");
    expect(session.text.state([id, other]).highlight).toBe("mixed");
    expect(session.text.state([other]).highlight).toBeNull();
    void ctx;
  });
});
