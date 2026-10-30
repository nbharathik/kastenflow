// The stage says which slide it shows, so a host that reads what is selected can say where in the deck it was.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { SlideCanvas } from "./SlideCanvas.tsx";

afterEach(cleanup);

describe("the stage", () => {
  it("carries the id and the number of the slide it shows, and follows the slide shown", async () => {
    const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
    const ui = new EditorUi();
    session.slides.add({ layout: "blank" });
    const view = render(<SlideCanvas session={session} ui={ui} />);
    const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
    const slides = session.deck.slides;
    expect(slides.length).toBeGreaterThanOrEqual(2);
    const shown = session.slide.id;
    expect(stage().dataset.slide).toBe(shown);
    expect(stage().dataset.slideNumber).toBe(String(slides.findIndex((s) => s.id === shown) + 1));
    const other = slides.find((s) => s.id !== shown)!;
    act(() => session.goTo(other.id));
    expect(stage().dataset.slide).toBe(other.id);
    expect(stage().dataset.slideNumber).toBe(String(slides.findIndex((s) => s.id === other.id) + 1));
  });
});
