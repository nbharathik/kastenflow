// Dragging slides with Alt or Ctrl held copies them: the originals stay where they are, the copies land where the slides in the hand
// were put down, in one step of undo. Without the key the drag moves them, as it always did.

import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { list, rowY, rows, setup } from "./list-support.tsx";
import { idsOf } from "./test-support.ts";

afterEach(cleanup);

type Keys = { altKey?: boolean; ctrlKey?: boolean };

/** A press, a pull and a release with the keys held on the way (and as it ends, which is where the drop is decided). */
function dragWith(from: HTMLElement, path: { y: number }[], keys: Keys, release: Keys = keys) {
  fireEvent.pointerDown(from, { button: 0, pointerId: 1, clientX: 10, clientY: path[0]!.y, ...keys });
  for (const step of path.slice(1)) fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: step.y, ...keys });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: path[path.length - 1]!.y, ...release });
}

const five = async () => {
  const made = await setup({ slides: 5 });
  return { ...made, ids: idsOf(made.session) as [string, string, string, string, string] };
};

describe("dragging slides with Alt or Ctrl", () => {
  it("copies one: the original stays, the copy lands before the slide it was put down on, and is the one picked and shown", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    dragWith(rows()[1]!, [{ y: rowY(1) }, { y: rowY(2) }, { y: rowY(4) }], { altKey: true });
    const now = idsOf(session);
    expect(now).toHaveLength(6);
    expect([now[0], now[1], now[2], now[3], now[5]]).toEqual([a, b, c, d, e]);
    const copy = now[4]!;
    expect(session.state.slideSelection).toEqual([copy]);
    expect(session.state.slideId).toBe(copy);
    expect(session.deck.slides[4]!.elements.map((el) => el.id)).toEqual(session.deck.slides[1]!.elements.map((el) => el.id));
  });

  it("copies with Ctrl as well, and takes all the slides picked, in their order", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    fireEvent.click(rows()[1]!);
    fireEvent.click(rows()[3]!, { ctrlKey: true });
    dragWith(rows()[3]!, [{ y: rowY(3) }, { y: rowY(4) }, { y: 5000 }], { ctrlKey: true });
    const now = idsOf(session);
    expect(now).toHaveLength(7);
    expect(now.slice(0, 5)).toEqual([a, b, c, d, e]);
    expect(session.state.slideSelection).toEqual(now.slice(5));
  });

  it("puts a copy at the very start when it is put down above the first slide", async () => {
    const { session, ids } = await five();
    dragWith(rows()[2]!, [{ y: rowY(2) }, { y: 0 }], { altKey: true });
    const now = idsOf(session);
    expect(now).toHaveLength(6);
    expect(now.slice(1)).toEqual(ids);
    expect(session.state.slideId).toBe(now[0]);
  });

  it("is one step of undo", async () => {
    const { session, ids } = await five();
    dragWith(rows()[1]!, [{ y: rowY(1) }, { y: rowY(4) }], { altKey: true });
    expect(session.deck.slides).toHaveLength(6);
    session.undo();
    expect(idsOf(session)).toEqual(ids);
  });

  it("moves, as before, when the key is let go before the slides are put down", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    dragWith(rows()[1]!, [{ y: rowY(1) }, { y: rowY(4) }], { altKey: true }, {});
    expect(idsOf(session)).toEqual([a, c, d, b, e]);
  });

  it("makes the copy even where the slides were taken from, next to its original, as Duplicate does", async () => {
    const { session, ids } = await five();
    dragWith(rows()[2]!, [{ y: rowY(2) }, { y: rowY(2) + 30 }], { altKey: true });
    // A copy next to its original: as Duplicate does.
    expect(session.deck.slides).toHaveLength(6);
    expect(idsOf(session).filter((id) => ids.includes(id as never))).toEqual(ids);
  });

  it("keeps Ctrl and a click, with no pull, for adding to and taking from the slides picked", async () => {
    const { session, ids } = await five();
    fireEvent.click(rows()[1]!);
    fireEvent.pointerDown(rows()[3]!, { button: 0, pointerId: 1, clientX: 10, clientY: rowY(3), ctrlKey: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: rowY(3), ctrlKey: true });
    fireEvent.click(rows()[3]!, { ctrlKey: true });
    expect(session.state.slideSelection).toEqual([ids[1], ids[3]]);
    expect(session.deck.slides).toHaveLength(5);
  });

  it("says that it is a copy while the key is held", async () => {
    const { container } = await five();
    fireEvent.pointerDown(rows()[1]!, { button: 0, pointerId: 1, clientX: 10, clientY: rowY(1) });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: rowY(3), altKey: true });
    const ghost = container.querySelector(".ks-drag-ghost");
    expect(ghost?.classList.contains("is-copy") || ghost?.querySelector(".ks-drag-copy") !== null).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: rowY(3) });
    expect(container.querySelector(".ks-drag-ghost.is-copy, .ks-drag-copy")).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: rowY(3) });
    expect(list()).toBeTruthy();
  });
});
