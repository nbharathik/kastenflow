// What is selected on the slide, and what is selected in the filmstrip, is not both at once: choosing slides leaves the elements of the
// slide, a press on bare space of the list does too, and the name of a section picks the slides in it until something else is picked.

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { list, pickedOf, rows, setup } from "./list-support.tsx";
import { idsOf } from "./test-support.ts";

afterEach(cleanup);

describe("choosing slides leaves the elements of the slide", () => {
  it("clears the elements selected on the slide that is shown when its own thumbnail is clicked", async () => {
    const { session } = await setup({ slides: 3 });
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    expect(session.state.selection).toEqual([a]);
    fireEvent.click(rows()[0]!);
    expect(session.state.selection).toEqual([]);
    expect(session.state.slideSelection).toEqual([session.state.slideId]);
  });

  it("clears them for a Shift or Ctrl click and for the arrow keys that widen the choice", async () => {
    const { session } = await setup({ slides: 4 });
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    fireEvent.click(rows()[2]!, { shiftKey: true });
    expect(session.state.selection).toEqual([]);
    act(() => session.select([a]));
    expect(session.state.selection).toEqual([a]);
    fireEvent.keyDown(list(), { key: "ArrowDown", shiftKey: true });
    expect(session.state.selection).toEqual([]);
  });

  it("clears them for a press on the bare space of the list, and the list has the keys", async () => {
    const { session, container } = await setup({ slides: 2 });
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    fireEvent.pointerDown(container.querySelector<HTMLElement>(".ks-filmstrip")!, { button: 0 });
    expect(session.state.selection).toEqual([]);
    expect(document.activeElement).toBe(list());
    // The slides stay as they were.
    expect(session.state.slideSelection).toEqual([session.state.slideId]);
  });

  it("does not clear them for a press on a slide's own row, which is a click that picks (and clears)", async () => {
    const { session } = await setup({ slides: 2 });
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    fireEvent.pointerDown(rows()[0]!, { button: 0 });
    // Only the click that follows picks the slide.
    expect(session.state.selection).toEqual([a]);
  });

  it("does not take Delete from the slides to the elements that were selected: the keys are the list's", async () => {
    const { session } = await setup({ slides: 3 });
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    const before = session.slide.elements.length;
    fireEvent.click(rows()[0]!);
    list().focus();
    fireEvent.keyDown(list(), { key: "Delete" });
    // The slide went, not the shape on it (which was not selected any more).
    expect(session.deck.slides).toHaveLength(2);
    expect(before).toBeGreaterThan(0);
  });
});

describe("the name of a section", () => {
  const sections = [
    { title: "Intro", at: 0 },
    { title: "Part two", at: 3 },
  ];

  it("picks the slides of its section, shows the first, and leaves the section open", async () => {
    const { session } = await setup({ slides: 6, sections });
    const ids = idsOf(session);
    fireEvent.click(screen.getByText("Part two"));
    expect(session.state.slideSelection).toEqual(ids.slice(3));
    expect(session.state.slideId).toBe(ids[3]);
    expect(pickedOf()).toEqual([3, 4, 5]);
    expect(rows()).toHaveLength(6);
  });

  it("picks the slides a folded section hides as well, and opens it, since the slide shown is in it", async () => {
    const { session } = await setup({ slides: 6, sections });
    const ids = idsOf(session);
    fireEvent.click(screen.getByRole("button", { name: "Collapse section Part two" }));
    expect(rows()).toHaveLength(3);
    fireEvent.click(screen.getByText("Part two"));
    expect(session.state.slideSelection).toEqual(ids.slice(3));
    expect(rows()).toHaveLength(6);
    expect(pickedOf()).toEqual([3, 4, 5]);
  });

  it("is let go when another slide is picked, and when the slide itself is pressed on", async () => {
    const { session } = await setup({ slides: 6, sections });
    const ids = idsOf(session);
    fireEvent.click(screen.getByText("Intro"));
    expect(session.state.slideSelection).toEqual(ids.slice(0, 3));
    fireEvent.click(rows()[4]!);
    expect(session.state.slideSelection).toEqual([ids[4]]);
    fireEvent.click(screen.getByText("Intro"));
    // A press on empty canvas collapses the choice to the slide shown.
    act(() => session.select([]));
    expect(session.state.slideSelection).toEqual([session.state.slideId]);
  });

  it("clears the elements of the slide, and the list has the keys", async () => {
    const { session } = await setup({ slides: 6, sections });
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    fireEvent.click(screen.getByText("Intro"));
    expect(session.state.selection).toEqual([]);
    expect(document.activeElement).toBe(list());
  });

  it("is folded and opened by its arrow, as before", async () => {
    await setup({ slides: 6, sections });
    fireEvent.click(screen.getByRole("button", { name: "Collapse section Part two" }));
    expect(rows()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Expand section Part two" }));
    expect(rows()).toHaveLength(6);
  });
});
