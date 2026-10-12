import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { plainText, shape, textBox } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { isUntouched, markFresh, settleFresh } from "./fresh.ts";

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  session.slides.add({ layout: "blank" });
  const made = () => {
    const [id] = session.elements.insert([textBox({ x: 100, y: 100, w: 300, h: 56 })]) as [string];
    markFresh(session, id);
    session.startEditing(id);
    return id;
  };
  const ids = () => session.slide.elements.map((e) => e.id);
  return { session, made, ids };
}

describe("a text box made empty and closed with nothing typed", () => {
  it("is taken away again as if it had never been made, leaving the history as it was", async () => {
    const { session, made, ids } = await open();
    const before = { label: session.state.undoLabel, revision: session.state.revision };
    const id = made();
    expect(session.state.undoLabel).toBe("add_elements");
    session.stopEditing();
    settleFresh(session, id);
    expect(ids()).not.toContain(id);
    expect(session.state.undoLabel).toBe(before.label);
    // The making can be redone, which is how undo treats anything.
    expect(session.state.canRedo).toBe(true);
  });

  it("stays when words were typed in it", async () => {
    const { session, made, ids } = await open();
    const id = made();
    session.elements.setText(id, plainText("Hello"));
    session.stopEditing();
    settleFresh(session, id);
    expect(ids()).toContain(id);
  });

  it("goes when the words were typed and then all taken out again, as one more step that undo can take back", async () => {
    const { session, made, ids } = await open();
    const id = made();
    session.elements.setText(id, plainText("Hello"));
    session.elements.setText(id, { paragraphs: [{ runs: [{ t: "" }] }] });
    session.stopEditing();
    settleFresh(session, id);
    expect(ids()).not.toContain(id);
    expect(session.state.undoLabel).toBe("delete_elements");
    session.undo();
    expect(ids()).toContain(id);
  });

  it("stays when it has a fill or an outline of its own, which is something to see", async () => {
    const { session, made, ids } = await open();
    const id = made();
    session.elements.style({ fill: { color: "accent1" } }, [id]);
    session.stopEditing();
    settleFresh(session, id);
    expect(ids()).toContain(id);
  });

  it("is the mark's business only: a box that was not made just now is left alone, however empty", async () => {
    const { session, ids } = await open();
    const [plain] = session.elements.insert([textBox({ x: 10, y: 10, w: 100, h: 40 })]) as [string];
    session.startEditing(plain);
    session.stopEditing();
    settleFresh(session, plain);
    expect(ids()).toContain(plain);
    // Nor is a shape, whose words are empty until someone types.
    const [rect] = session.elements.insert([shape("rect", { x: 200, y: 10, w: 100, h: 40 })]) as [string];
    markFresh(session, rect);
    session.stopEditing();
    settleFresh(session, rect);
    expect(ids()).toContain(rect);
  });

  it("is left alone while the box is still open", async () => {
    const { session, made, ids } = await open();
    const id = made();
    settleFresh(session, id);
    expect(ids()).toContain(id);
    // Not closed, so still the mark's: closing it later takes it away.
    session.stopEditing();
    settleFresh(session, id);
    expect(ids()).not.toContain(id);
  });

  it("is taken away once: the same box opened again later is not the mark's any more", async () => {
    const { session, made, ids } = await open();
    const id = made();
    session.elements.setText(id, plainText("Hi"));
    session.stopEditing();
    settleFresh(session, id);
    session.elements.setText(id, { paragraphs: [{ runs: [{ t: "" }] }] });
    session.startEditing(id);
    session.stopEditing();
    settleFresh(session, id);
    expect(ids()).toContain(id);
  });

  it("stays when the person has gone to another slide, which it cannot be taken from", async () => {
    const { session, made, ids } = await open();
    const first = session.state.slideId;
    const id = made();
    session.slides.add({ layout: "blank" });
    expect(session.state.slideId).not.toBe(first);
    settleFresh(session, id);
    expect(session.deck.slides.find((s) => s.id === first)?.elements.map((e) => e.id)).toContain(id);
    expect(ids()).not.toContain(id);
  });
});

describe("the first words typed in a box made just now", () => {
  const wordsOf = (session: EditorSession, id: string): string => {
    const found = session.slide.elements.find((e) => e.id === id);
    return found?.type === "text" ? found.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n") : "";
  };

  it("are one step of undo with the box, and of redo", async () => {
    const { session, made, ids } = await open();
    const slide = session.state.slideId;
    const before = session.state.undoLabel;
    const id = made();
    expect(isUntouched(session, id, slide)).toBe(true);
    session.elements.setText(id, plainText("Hello"), slide, true);
    expect(wordsOf(session, id)).toBe("Hello");
    expect(session.state.undoLabel).toBe("add_elements");
    session.undo();
    expect(ids(), "the box and the words go together").not.toContain(id);
    expect(session.state.undoLabel).toBe(before);
    session.redo();
    expect(wordsOf(session, id)).toBe("Hello");
  });

  it("are a step of their own when something else was done to the deck after the box was made", async () => {
    const { session, made, ids } = await open();
    const slide = session.state.slideId;
    const id = made();
    session.elements.style({ fill: { color: "accent1" } }, [id]);
    expect(isUntouched(session, id, slide)).toBe(false);
    session.elements.setText(id, plainText("Hello"), slide, isUntouched(session, id, slide));
    session.undo();
    expect(ids()).toContain(id);
    expect(wordsOf(session, id)).toBe("");
  });

  it("are not joined to a box that was not made just now, or on another slide", async () => {
    const { session, made } = await open();
    const slide = session.state.slideId;
    const [plain] = session.elements.insert([textBox({ x: 10, y: 10, w: 100, h: 40 })]) as [string];
    expect(isUntouched(session, plain, slide), "never marked").toBe(false);
    const id = made();
    expect(isUntouched(session, id, "s-elsewhere")).toBe(false);
    session.stopEditing();
    settleFresh(session, id);
    expect(isUntouched(session, id, slide), "the mark is spent when editing ends").toBe(false);
  });
});
