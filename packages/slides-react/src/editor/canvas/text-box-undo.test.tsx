// Making a text box and typing in it is one step of undo: one Undo takes the box away with its words, one Redo brings both back.
// A box that was there before, or one that something was done to after it was made, keeps its typing as a step of its own.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { textBox } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { addTextBoxNow } from "../quick-add/add.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { SlideCanvas } from "./SlideCanvas.tsx";

afterEach(cleanup);

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
});

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  session.slides.add();
  render(<SlideCanvas session={session} ui={ui} />);
  const words = (id: string): string => {
    const found = session.slide.elements.find((e) => e.id === id);
    return found?.type === "text" ? found.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n") : "";
  };
  return { session, ui, words, ids: () => session.slide.elements.map((e) => e.id) };
}

describe("a text box made and typed in", () => {
  it("is one step of undo and of redo", async () => {
    const { session, ui, words, ids } = await open();
    const before = session.state.undoLabel;
    act(() => addTextBoxNow({ session, ui }));
    const id = session.state.editing!;
    expect(ui.state.text, "the editor is open with the caret in it").not.toBeNull();
    act(() => ui.state.text!.insertText("Hello"));
    act(() => session.stopEditing());
    expect(words(id)).toBe("Hello");
    expect(session.state.undoLabel).toBe("add_elements");

    act(() => session.undo());
    expect(ids(), "one undo takes the box and its words").not.toContain(id);
    expect(session.state.undoLabel).toBe(before);
    act(() => session.redo());
    expect(words(id)).toBe("Hello");
  });

  it("goes again, with nothing left to undo, when nothing was typed", async () => {
    const { session, ui, ids } = await open();
    const before = session.state.undoLabel;
    act(() => addTextBoxNow({ session, ui }));
    const id = session.state.editing!;
    act(() => session.stopEditing());
    expect(ids()).not.toContain(id);
    expect(session.state.undoLabel).toBe(before);
  });

  it("keeps the typing of a box that was already there as a step of its own", async () => {
    const { session, ui, words, ids } = await open();
    const [id] = session.elements.insert([textBox({ x: 100, y: 100, w: 300, h: 56 }, "One")]) as [string];
    act(() => session.startEditing(id));
    expect(ui.state.text).not.toBeNull();
    act(() => ui.state.text!.insertText(" two"));
    act(() => session.stopEditing());
    expect(words(id)).toBe("One two");
    expect(session.state.undoLabel).toBe("set_rich_text");
    act(() => session.undo());
    expect(ids()).toContain(id);
    expect(words(id)).toBe("One");
  });
});
