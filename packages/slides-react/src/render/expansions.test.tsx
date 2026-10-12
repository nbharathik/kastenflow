// What a drag, a resize and an edit cost in WebAssembly calls on a deck of 30 slides with code on each: nothing that is
// not itself changed is expanded again. The engine counts its expansions (`expansionCount`).

import { type Deck, type Element, type Slide, expandComposite, expansionCount } from "@kasten-slides/wasm";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { withOverrides } from "../editor/canvas/SlideCanvas.tsx";
import { MemoryHost } from "../editor/memory-host.ts";
import { EditorSession } from "../editor/session/session.ts";
import { newDeck } from "../test/engine.ts";
import { SlideView } from "./SlideView.tsx";

afterEach(cleanup);

/** 30 slides, each with a code block, a text box and a shape. The shown one is the tenth. */
async function thirty() {
  const engine = await newDeck("Thirty");
  for (let i = 0; i < 30; i++) {
    const added = engine.apply("add_slide", { layout: "blank" });
    engine.apply("add_elements", {
      slide: added.output.slide,
      elements: [
        { type: "code", id: "code", language: "python", code: `print(${i})\nprint(${i + 1})`, x: 64, y: 160, w: 500, h: 240 },
        { type: "text", id: "words", x: 600, y: 160, w: 280, h: 60, text: { paragraphs: [{ runs: [{ t: `Slide ${i}` }] }] } },
        { type: "shape", id: "box", shape: "rect", x: 600, y: 300, w: 200, h: 100 },
      ] as Element[],
    });
  }
  const session = new EditorSession(engine, new MemoryHost(), { saveDelay: 60_000 });
  session.goTo(session.deck.slides[10]!.id);
  return session;
}

const view = (deck: Deck, slide: Slide) => <SlideView deck={deck} slide={slide} number={11} count={31} mode="edit" />;

describe("a deck of 30 slides with code on each", () => {
  it("expands the code of the slide on the screen once, and nothing again for a drag or a resize of something else", async () => {
    const session = await thirty();
    const { rerender } = render(view(session.deck, session.slide));
    const drawn = expansionCount();
    // Each step of a drag or a resize makes a new slide object with the box in its new place: this is what the canvas draws.
    for (let step = 1; step <= 25; step++) {
      const moved = withOverrides(session.slide, new Map([["box", { x: 600 + step, y: 300 + step, w: 200 + step * 2, h: 100 + step }]]), session.deck.theme);
      expect(moved).not.toBe(session.slide);
      rerender(view(session.deck, moved));
      const turned = withOverrides(session.slide, new Map([["words", { x: 600, y: 160, w: 280, h: 60, rotation: step }]]), session.deck.theme);
      rerender(view(session.deck, turned));
    }
    expect(expansionCount()).toBe(drawn);
    // Letting go changes the deck: the engine hands over the whole slide again, and the code on it is still the same object.
    const code = session.slide.elements.find((e) => e.id === "code");
    session.elements.place(new Map([["box", { x: 650, y: 350, w: 250, h: 125 }]]));
    expect(session.slide.elements.find((e) => e.id === "code")).toBe(code);
    rerender(view(session.deck, session.slide));
    // Undo and redo take the box back and forth, and the slide the code is on with it.
    session.undo();
    rerender(view(session.deck, session.slide));
    session.redo();
    rerender(view(session.deck, session.slide));
    expect(expansionCount()).toBe(drawn);
  });

  it("expands the code that is itself resized, once for each size it is drawn at, and not again when it goes back to one", async () => {
    const session = await thirty();
    const { rerender } = render(view(session.deck, session.slide));
    const drawn = expansionCount();
    for (let step = 1; step <= 10; step++) {
      rerender(view(session.deck, withOverrides(session.slide, new Map([["code", { x: 64, y: 160, w: 500 + step * 10, h: 240 }]]), session.deck.theme)));
    }
    // A box of its own new size has to be drawn again, which is one expansion for each size.
    expect(expansionCount() - drawn).toBe(10);
    // Back to the size it had: that is in what was kept.
    rerender(view(session.deck, session.slide));
    expect(expansionCount() - drawn).toBe(10);
    for (let step = 1; step <= 10; step++) {
      rerender(view(session.deck, withOverrides(session.slide, new Map([["code", { x: 64, y: 160, w: 500 + step * 10, h: 240 }]]), session.deck.theme)));
    }
    expect(expansionCount() - drawn).toBe(10);
  });

  it("does not expand the code again when a slide is edited, typed into, or when it is shown from the filmstrip again", async () => {
    const session = await thirty();
    const { rerender } = render(view(session.deck, session.slide));
    const drawn = expansionCount();
    session.slides.setNotes("A note");
    rerender(view(session.deck, session.slide));
    session.elements.patch({ name: "Words" }, ["words"]);
    rerender(view(session.deck, session.slide));
    session.goTo(session.deck.slides[11]!.id);
    rerender(view(session.deck, session.slide));
    const second = expansionCount();
    expect(second - drawn).toBe(1);
    session.goTo(session.deck.slides[10]!.id);
    rerender(view(session.deck, session.slide));
    expect(expansionCount()).toBe(second);
  });

  it("keeps the same expansion for an element that is a new object with the same content", async () => {
    const session = await thirty();
    const code = session.slide.elements.find((e) => e.id === "code")!;
    const first = expandComposite(session.deck.theme, session.slide.layout, code);
    const drawn = expansionCount();
    expect(expandComposite(session.deck.theme, session.slide.layout, structuredClone(code))).toBe(first);
    expect(expansionCount()).toBe(drawn);
    // Other content is another expansion.
    const other = { ...structuredClone(code), code: "print(2)" } as Element;
    expect(expandComposite(session.deck.theme, session.slide.layout, other)).not.toBe(first);
    expect(expansionCount()).toBe(drawn + 1);
  });
});
