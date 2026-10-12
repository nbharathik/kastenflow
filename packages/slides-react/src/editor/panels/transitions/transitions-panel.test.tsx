import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { edit, mount } from "../format/test-kit.tsx";
import { KINDS, USUAL, arrivesWith, chosen, said } from "./transitions.ts";

afterEach(cleanup);

const kind = (name: string) => screen.getByRole("option", { name: new RegExp(`^${name}`) });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("what the panel says about transitions", () => {
  it("has the four kinds, with the usual time of each", () => {
    expect(KINDS.map((k) => k.value)).toEqual(["none", "fade", "slide", "morph"]);
    expect(USUAL).toEqual({ none: 0, fade: 0.4, slide: 0.4, morph: 0.6 });
  });

  it("tells a transition in words, and has no time for none", () => {
    expect(said({ kind: "fade", duration: 0.4 })).toBe("Fade, 0.4 seconds");
    expect(said({ kind: "morph" })).toBe("Morph, 0.6 seconds");
    expect(said({ kind: "none" })).toBe("None");
    expect(chosen("none", 3)).toEqual({ kind: "none" });
    expect(chosen("slide", 99)).toEqual({ kind: "slide", duration: 10 });
    expect(chosen("fade", -1)).toEqual({ kind: "fade", duration: 0 });
  });

  it("takes the slide's own transition, else the deck's", () => {
    expect(arrivesWith({ transition: { kind: "fade" } }, { kind: "slide" })).toEqual({ kind: "fade" });
    expect(arrivesWith({}, { kind: "slide" })).toEqual({ kind: "slide" });
    expect(arrivesWith({ transition: null }, undefined)).toBeNull();
    expect(arrivesWith(undefined, null)).toBeNull();
  });
});

describe("the transitions panel", () => {
  it("starts on None, with no time to set and nothing to play", async () => {
    await mount({ panel: "transitions" });
    expect(kind("None").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("textbox", { name: "Duration" })).toBeNull();
    expect(button("Play").disabled).toBe(true);
  });

  it("makes the kind picked the slide's transition at once, as one step, and plays it on the slide", async () => {
    const kit = await mount({ panel: "transitions" });
    const revision = kit.session.state.revision;
    fireEvent.click(kind("Fade"));
    expect(kit.session.slide.transition).toEqual({ kind: "fade", duration: 0.4 });
    expect(kit.session.state.revision).toBe(revision + 1);
    expect(kit.ui.state.transitionPreview).toMatchObject({ kind: "fade", duration: 0.4 });
    expect(kind("Fade").getAttribute("aria-selected")).toBe("true");
    edit(() => kit.session.undo());
    expect(kit.session.slide.transition ?? null).toBeNull();
    expect(kit.errors).toEqual([]);
  });

  it("sets the time, plays it again, and has Play for the same", async () => {
    const kit = await mount({ panel: "transitions" });
    fireEvent.click(kind("Slide"));
    const first = kit.ui.state.transitionPreview!.id;
    const seconds = screen.getByRole("textbox", { name: "Duration" }) as HTMLInputElement;
    fireEvent.change(seconds, { target: { value: "1.5" } });
    fireEvent.blur(seconds);
    expect(kit.session.slide.transition).toEqual({ kind: "slide", duration: 1.5 });
    expect(kit.ui.state.transitionPreview).toMatchObject({ kind: "slide", duration: 1.5 });
    const second = kit.ui.state.transitionPreview!.id;
    expect(second).toBeGreaterThan(first);
    fireEvent.click(button("Play"));
    expect(kit.ui.state.transitionPreview!.id).toBeGreaterThan(second);
    expect(kit.session.deck.present.transition).toBeUndefined();
  });

  it("applies to every slide with one button", async () => {
    const kit = await mount({ panel: "transitions" });
    edit(() => void kit.session.slides.add({ layout: "title-only" }));
    fireEvent.click(kind("Morph"));
    expect(kit.session.deck.slides.filter((s) => s.transition).length).toBe(1);
    fireEvent.click(button("Apply to all slides"));
    expect(kit.session.deck.slides.every((s) => s.transition?.kind === "morph")).toBe(true);
  });

  it("makes the choice the deck's own, which slides that name none follow", async () => {
    const kit = await mount({ panel: "transitions" });
    expect(screen.getByText(/arrive with:/).textContent).toContain("None");
    fireEvent.click(kind("Fade"));
    fireEvent.click(button("Use this for the deck"));
    expect(kit.session.deck.present.transition).toMatchObject({ kind: "fade", duration: 0.4 });
    expect(screen.getByText(/arrive with:/).textContent).toContain("Fade, 0.4 seconds");
    // A slide that has none of its own shows the deck's.
    edit(() => void kit.session.slides.add({ layout: "title-only" }));
    expect(kind("Fade").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/follows the deck: Fade, 0.4 seconds/)).toBeTruthy();
  });

  it("says how many clicks the slide has, and opens the steps", async () => {
    const kit = await mount({ panel: "transitions" });
    expect(screen.getByText(/Elements all appear with the slide/)).toBeTruthy();
    act(() => kit.session.steps.setSteps(2));
    expect(screen.getByText(/This slide has 2 clicks/)).toBeTruthy();
    fireEvent.click(button("Open steps"));
    expect(kit.ui.state.panel).toBe("steps");
  });

  it("moves over the kinds with the arrow keys", async () => {
    await mount({ panel: "transitions" });
    const none = kind("None");
    none.focus();
    fireEvent.keyDown(none, { key: "ArrowDown" });
    expect(document.activeElement).toBe(kind("Fade"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(kind("Morph"));
  });
});
