import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIST_PAD } from "./model.ts";
import { ROW, drag, list, rowY, rows, setup } from "./list-support.tsx";
import { idsOf } from "./test-support.ts";

afterEach(cleanup);

describe("dragging to reorder", () => {
  const five = async () => {
    const made = await setup({ slides: 5 });
    return { ...made, ids: idsOf(made.session) as [string, string, string, string, string] };
  };

  it("moves a slide down", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    drag(rows()[1]!, [{ y: rowY(1) }, { y: rowY(2) }, { y: rowY(4) }]);
    expect(idsOf(session)).toEqual([a, c, d, b, e]);
    // The slide that was moved is the one shown.
    expect(session.state.slideId).toBe(b);
  });

  it("moves a slide up", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    drag(rows()[3]!, [{ y: rowY(3) }, { y: rowY(1) }]);
    expect(idsOf(session)).toEqual([a, d, b, c, e]);
  });

  it("moves a slide to either end", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    drag(rows()[2]!, [{ y: rowY(2) }, { y: 0 }]);
    expect(idsOf(session)).toEqual([c, a, b, d, e]);
    drag(rows()[0]!, [{ y: rowY(0) }, { y: 5000 }]);
    expect(idsOf(session)).toEqual([a, b, d, e, c]);
  });

  it("moves all the selected slides, whichever is pulled", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    fireEvent.click(rows()[1]!);
    fireEvent.click(rows()[3]!, { ctrlKey: true });
    drag(rows()[3]!, [{ y: rowY(3) }, { y: 0 }]);
    expect(idsOf(session)).toEqual([b, d, a, c, e]);
    // The pair went together: pulled by the other one to the end.
    drag(rows()[0]!, [{ y: rowY(0) }, { y: 5000 }]);
    expect(idsOf(session)).toEqual([a, c, e, b, d]);
    expect(session.state.slideSelection).toEqual([b, d]);
  });

  it("takes just the slide pulled when it is not one of those selected", async () => {
    const { session, ids } = await five();
    const [a, b, c, d, e] = ids;
    fireEvent.click(rows()[0]!);
    fireEvent.click(rows()[1]!, { ctrlKey: true });
    drag(rows()[4]!, [{ y: rowY(4) }, { y: rowY(0) }]);
    expect(idsOf(session)).toEqual([e, a, b, c, d]);
    expect(session.state.slideSelection).toEqual([e]);
  });

  it("does nothing when the slide is dropped where it was", async () => {
    const { session, ids } = await five();
    const before = session.deck;
    // Over itself, just before itself, just after itself.
    drag(rows()[2]!, [{ y: rowY(2) }, { y: rowY(2) + 30 }]);
    drag(rows()[2]!, [{ y: rowY(2) }, { y: rowY(3) }]);
    drag(rows()[2]!, [{ y: rowY(2) }, { y: rowY(2) - 20 }]);
    expect(session.deck).toBe(before);
    expect(idsOf(session)).toEqual(ids);
    expect(session.state.slideId).toBe(ids[2]);
  });

  it("does nothing when it is dropped far to the side of the list, or the pointer moves too little to be a drag", async () => {
    const { session, ids } = await five();
    const before = session.deck;
    drag(rows()[1]!, [{ y: rowY(1) }, { x: 900, y: rowY(4) }]);
    expect(session.deck).toBe(before);
    drag(rows()[1]!, [{ y: rowY(1) }, { y: rowY(1) + 3 }]);
    expect(session.deck).toBe(before);
    expect(idsOf(session)).toEqual(ids);
  });

  const shifts = () => rows().map((row) => row.style.transform);

  it("stops on Escape, and the rows come back", async () => {
    const { session } = await five();
    const before = session.deck;
    drag(rows()[1]!, [{ y: rowY(1) }, { y: rowY(4) }], { release: false });
    // The slide pulled is out of the list: the rows between it and the gap close up.
    expect(shifts()).toEqual(["", "", `translateY(${-ROW}px)`, `translateY(${-ROW}px)`, ""]);
    expect(document.querySelector(".ks-drag-ghost")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shifts().every((shift) => shift === "")).toBe(true);
    expect(document.querySelector(".ks-drag-ghost")).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: rowY(4) });
    expect(session.deck).toBe(before);
  });

  it("opens a gap where the slides would land, and only when that changes something", async () => {
    await five();
    drag(rows()[1]!, [{ y: rowY(1) }, { y: rowY(3) }], { release: false });
    // Pulled to the gap before the fourth slide: the third closes up, and the fourth and fifth are where the gap leaves them.
    expect(shifts()).toEqual(["", "", `translateY(${-ROW}px)`, "", ""]);
    expect(list().classList.contains("is-shifted")).toBe(true);
    expect(rows()[1]!.classList.contains("is-dragging")).toBe(true);
    expect(rows()[2]!.classList.contains("is-dragging")).toBe(false);
    // Back over its own place: the gap is where the slide was, so nothing is shifted.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: rowY(2) });
    expect(shifts().every((shift) => shift === "")).toBe(true);
    // Past the last: every row after it closes up.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 5000 });
    expect(shifts()).toEqual(["", "", `translateY(${-ROW}px)`, `translateY(${-ROW}px)`, `translateY(${-ROW}px)`]);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5000 });
    // Put down: nothing is shifted, nothing is in the hand, and the rows do not glide to places they made room at.
    expect(shifts().every((shift) => shift === "")).toBe(true);
    expect(rows().some((row) => row.classList.contains("is-dragging"))).toBe(false);
    expect(list().hasAttribute("data-still")).toBe(true);
    expect(document.querySelector(".ks-drag-ghost")).toBeNull();
  });

  it("holds a copy of each thumbnail under the pointer, stacked", async () => {
    await five();
    drag(rows()[2]!, [{ y: rowY(2) }, { y: rowY(4) }], { release: false });
    expect(document.querySelectorAll(".ks-drag-ghost .ks-drag-card")).toHaveLength(1);
    expect(document.querySelector(".ks-drag-ghost .ks-fs-frame")).not.toBeNull();
    // One slide has no count.
    expect(document.querySelector(".ks-drag-badge")).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: rowY(4) });
    // The click the browser sends after a release is not a click on a slide, and is let go by.
    await new Promise((resolve) => setTimeout(resolve, 5));
    fireEvent.click(rows()[0]!);
    fireEvent.click(rows()[2]!, { shiftKey: true });
    drag(rows()[0]!, [{ y: rowY(0) }, { y: rowY(4) }], { release: false });
    expect(document.querySelectorAll(".ks-drag-ghost .ks-drag-card")).toHaveLength(3);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: rowY(4) });
  });

  it("says how many slides are in the hand when there are several", async () => {
    await five();
    fireEvent.click(rows()[0]!);
    fireEvent.click(rows()[2]!, { shiftKey: true });
    drag(rows()[0]!, [{ y: rowY(0) }, { y: rowY(4) }], { release: false });
    expect(document.querySelector(".ks-drag-badge")?.textContent).toBe("3 slides");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: rowY(4) });
    expect(document.querySelector(".ks-drag-badge")).toBeNull();
  });

  it("does not take the click that ends a drag for a click on a slide", async () => {
    const { session, ids } = await five();
    fireEvent.click(rows()[1]!);
    fireEvent.click(rows()[3]!, { ctrlKey: true });
    drag(rows()[1]!, [{ y: rowY(1) }, { y: 5000 }]);
    // The browser sends a click after the release; it must not collapse the selection.
    fireEvent.click(rows()[3]!);
    expect(session.state.slideSelection).toEqual([ids[1], ids[3]]);
    // The next click is an ordinary one.
    fireEvent.click(rows()[0]!);
    expect(session.state.slideSelection).toEqual([ids[0]]);
  });

  it("drops above a section header by the gap before the section", async () => {
    const made = await setup({ slides: 5, sections: [{ title: "Two", at: 3 }] });
    const ids = idsOf(made.session);
    // The header of section "Two" is after slide 3; its top is at LIST_PAD + 3 * ROW.
    const header = LIST_PAD + 3 * ROW;
    drag(rows()[0]!, [{ y: rowY(0) }, { y: header + 4 }]);
    expect(idsOf(made.session)).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
  });
});

describe("scrolling", () => {
  it("scrolls a slide that is shown from elsewhere into view", async () => {
    const height = vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("ks-filmstrip") ? 400 : 0;
    });
    try {
      const { session, container } = await setup({ slides: 10 });
      const scroller = container.querySelector(".ks-filmstrip") as HTMLElement;
      const last = idsOf(session)[9]!;
      act(() => session.goTo(last));
      // The last row ends at LIST_PAD + 10 rows; it is put at the foot of the window, less a margin.
      expect(scroller.scrollTop).toBe(LIST_PAD + 10 * ROW - 400 + 8);
      act(() => session.goTo(idsOf(session)[0]!));
      expect(scroller.scrollTop).toBe(0);
      // A slide already in view is left alone.
      act(() => session.goTo(idsOf(session)[2]!));
      expect(scroller.scrollTop).toBe(0);
    } finally {
      height.mockRestore();
    }
  });
});
