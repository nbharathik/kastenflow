// The grid view lets go of what was picked when something else is: a press on its bare space takes the picked slides back to the one
// shown, and the elements that were selected on the slide are no longer selected (the keys are the grid's).

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { idsOf, openDeck } from "../filmstrip/test-support.ts";
import { GridView } from "./GridView.tsx";

afterEach(cleanup);

async function setup(slides = 5) {
  const made = await openDeck({ slides });
  const view = render(<GridView session={made.session} ui={made.ui} />);
  return { ...made, ...view, ids: idsOf(made.session) };
}

const tiles = () => screen.getAllByRole("option");
const grid = () => screen.getByRole("listbox", { name: "Slides" });

describe("a press on the bare space of the grid", () => {
  it("takes several picked slides back to the one shown, and the grid has the keys", async () => {
    const { session, ids } = await setup();
    fireEvent.click(tiles()[1]!);
    fireEvent.click(tiles()[3]!, { shiftKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(1, 4));
    fireEvent.pointerDown(grid(), { button: 0 });
    expect(session.state.slideSelection).toEqual([ids[1]]);
    expect(document.activeElement).toBe(grid());
  });

  it("also takes it from the space between the tiles", async () => {
    const { session, ids, container } = await setup();
    fireEvent.click(tiles()[0]!);
    fireEvent.click(tiles()[2]!, { shiftKey: true });
    expect(session.state.slideSelection).toHaveLength(3);
    fireEvent.pointerDown(container.querySelector<HTMLElement>(".ks-gv-grid")!, { button: 0 });
    expect(session.state.slideSelection).toEqual([ids[0]]);
  });

  it("is not a press on a tile: a tile is picked by its click", async () => {
    const { session, ids } = await setup();
    fireEvent.click(tiles()[1]!);
    fireEvent.click(tiles()[3]!, { shiftKey: true });
    fireEvent.pointerDown(tiles()[2]!, { button: 0 });
    expect(session.state.slideSelection).toEqual(ids.slice(1, 4));
  });
});

describe("choosing a tile", () => {
  it("leaves the elements of the slide shown", async () => {
    const { session } = await setup();
    const [a] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 100, h: 100 })]) as [string];
    act(() => session.select([a]));
    fireEvent.click(tiles()[0]!);
    expect(session.state.selection).toEqual([]);
  });
});
