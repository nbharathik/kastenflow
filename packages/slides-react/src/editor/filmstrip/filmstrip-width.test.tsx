// The filmstrip is as wide as the person made it: 160 to 360 pixels, dragged or moved with the arrow keys by the edge between it and the slide,
// kept in this browser. The thumbnails and the rows follow the width.

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FILMSTRIP_WIDTH_KEY } from "../ui-prefs.ts";
import { rows, setup } from "./list-support.tsx";
import { FILMSTRIP_MAX, FILMSTRIP_MIN, FILMSTRIP_W, FRAME, LIST_PAD, ROW_PAD, THUMB_W, backupWidth, layoutFilmstrip, thumbHeight, thumbWidth } from "./model.ts";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const grip = () => screen.getByRole("separator", { name: "Resize the filmstrip" });
const wrap = (container: HTMLElement) => container.querySelector<HTMLElement>(".ks-filmstrip-wrap")!;
const listOf = (container: HTMLElement) => container.querySelector<HTMLElement>(".ks-fs-list")!;
const press = (key: string, extra: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(grip(), { key, ...extra });

describe("the sizes", () => {
  it("make a thumbnail 160 wide at the usual width, and follow the width of the filmstrip", () => {
    expect(FILMSTRIP_W).toBe(208);
    expect(THUMB_W).toBe(160);
    expect(thumbWidth(208)).toBe(160);
    expect(thumbWidth(FILMSTRIP_MIN)).toBe(112);
    expect(thumbWidth(FILMSTRIP_MAX)).toBe(312);
    expect(backupWidth(160)).toBe(146);
  });

  it("make a row as tall as its thumbnail, so the rows get taller as the filmstrip gets wider", () => {
    const deck = { slides: [{ id: "a", layout: "blank", elements: [] }], sections: [], size: { w: 960, h: 540 } };
    const narrow = layoutFilmstrip(deck, new Set(), thumbWidth(FILMSTRIP_MIN));
    const wide = layoutFilmstrip(deck, new Set(), thumbWidth(FILMSTRIP_MAX));
    expect(narrow.rowHeight).toBe(thumbHeight(deck.size, 112) + FRAME + 2 * ROW_PAD);
    expect(wide.rowHeight).toBe(thumbHeight(deck.size, 312) + FRAME + 2 * ROW_PAD);
    expect(wide.height).toBe(LIST_PAD + wide.rowHeight + LIST_PAD);
    expect(layoutFilmstrip(deck, new Set()).rowHeight).toBe(layoutFilmstrip(deck, new Set(), 160).rowHeight);
  });
});

describe("the edge", () => {
  it("is a separator with its value and bounds, and the filmstrip starts at 208", async () => {
    const { container } = await setup({ slides: 3 });
    expect(grip().getAttribute("aria-orientation")).toBe("vertical");
    expect([grip().getAttribute("aria-valuemin"), grip().getAttribute("aria-valuenow"), grip().getAttribute("aria-valuemax")]).toEqual(["160", "208", "360"]);
    expect(grip().tabIndex).toBe(0);
    expect(wrap(container).style.getPropertyValue("--ks-filmstrip-w")).toBe("208px");
  });

  it("moves with the arrow keys (right is wider, Shift for more), stops at the bounds, and goes to the ends with Home and End", async () => {
    const { container } = await setup({ slides: 3 });
    grip().focus();
    press("ArrowRight");
    expect(grip().getAttribute("aria-valuenow")).toBe("224");
    expect(wrap(container).style.getPropertyValue("--ks-filmstrip-w")).toBe("224px");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(grip().getAttribute("aria-valuenow")).toBe("192");
    press("ArrowRight", { shiftKey: true });
    expect(grip().getAttribute("aria-valuenow")).toBe("240");
    press("Home");
    expect(grip().getAttribute("aria-valuenow")).toBe("160");
    press("ArrowLeft");
    expect(grip().getAttribute("aria-valuenow")).toBe("160");
    press("End");
    expect(grip().getAttribute("aria-valuenow")).toBe("360");
    press("ArrowRight", { shiftKey: true });
    expect(grip().getAttribute("aria-valuenow")).toBe("360");
  });

  it("takes only its own keys: another key goes on, an arrow stays here", async () => {
    await setup({ slides: 3 });
    expect(press("a")).toBe(true);
    expect(press("ArrowRight")).toBe(false);
  });

  it("is dragged with the pointer, kept when the pointer is let go, and put back to 208 by a double click", async () => {
    const { container } = await setup({ slides: 3 });
    fireEvent.pointerDown(grip(), { button: 0, clientX: 208, pointerId: 1 });
    fireEvent.pointerMove(grip(), { clientX: 280, pointerId: 1 });
    expect(grip().getAttribute("aria-valuenow")).toBe("280");
    expect(wrap(container).style.getPropertyValue("--ks-filmstrip-w")).toBe("280px");
    // Not kept while it is being dragged.
    expect(localStorage.getItem(FILMSTRIP_WIDTH_KEY)).toBeNull();
    fireEvent.pointerMove(grip(), { clientX: 900, pointerId: 1 });
    expect(grip().getAttribute("aria-valuenow")).toBe("360");
    fireEvent.pointerUp(grip(), { clientX: 900, pointerId: 1 });
    expect(localStorage.getItem(FILMSTRIP_WIDTH_KEY)).toBe("360");
    // A move after the pointer was let go is not a drag.
    fireEvent.pointerMove(grip(), { clientX: 100, pointerId: 1 });
    expect(grip().getAttribute("aria-valuenow")).toBe("360");
    fireEvent.doubleClick(grip());
    expect(grip().getAttribute("aria-valuenow")).toBe("208");
    expect(localStorage.getItem(FILMSTRIP_WIDTH_KEY)).toBe("208");
  });

  it("ignores a press that is not the main button", async () => {
    await setup({ slides: 3 });
    fireEvent.pointerDown(grip(), { button: 2, clientX: 208, pointerId: 1 });
    fireEvent.pointerMove(grip(), { clientX: 300, pointerId: 1 });
    expect(grip().getAttribute("aria-valuenow")).toBe("208");
  });
});

describe("the width that was kept", () => {
  it("is kept under ks-filmstrip-width and used the next time the filmstrip is shown", async () => {
    const first = await setup({ slides: 3 });
    grip().focus();
    press("ArrowRight", { shiftKey: true });
    expect(localStorage.getItem("ks-filmstrip-width")).toBe("256");
    cleanup();
    first.session.dispose?.();
    const again = await setup({ slides: 3 });
    expect(grip().getAttribute("aria-valuenow")).toBe("256");
    expect(wrap(again.container).style.getPropertyValue("--ks-filmstrip-w")).toBe("256px");
  });

  it("is held between the bounds, and the usual width is used when what was kept is not a number or cannot be read", async () => {
    localStorage.setItem(FILMSTRIP_WIDTH_KEY, "9000");
    await setup({ slides: 3 });
    expect(grip().getAttribute("aria-valuenow")).toBe("360");
    cleanup();
    localStorage.setItem(FILMSTRIP_WIDTH_KEY, "narrow");
    await setup({ slides: 3 });
    expect(grip().getAttribute("aria-valuenow")).toBe("208");
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await setup({ slides: 3 });
    expect(grip().getAttribute("aria-valuenow")).toBe("208");
    // The width still holds for this window though nothing can be kept.
    press("ArrowRight");
    expect(grip().getAttribute("aria-valuenow")).toBe("224");
    vi.restoreAllMocks();
  });
});

describe("the thumbnails and the rows", () => {
  it("are as wide as the filmstrip allows: the drawn slides, the frames and the rows' heights all follow", async () => {
    const { container } = await setup({ slides: 3 });
    const widthOf = () => container.querySelector<HTMLElement>(".ks-thumb")?.style.width;
    expect(widthOf()).toBe("160px");
    expect(listOf(container).style.getPropertyValue("--fs-w")).toBe("162px");
    grip().focus();
    press("End");
    expect(widthOf()).toBe("312px");
    expect(listOf(container).style.getPropertyValue("--fs-w")).toBe("314px");
    expect(listOf(container).style.getPropertyValue("--fs-row")).toBe(`${thumbHeight({ w: 960, h: 540 }, 312) + FRAME + 2 * ROW_PAD}px`);
    expect(listOf(container).style.height).toBe(`${LIST_PAD * 2 + 3 * (thumbHeight({ w: 960, h: 540 }, 312) + FRAME + 2 * ROW_PAD)}px`);
    press("Home");
    expect(widthOf()).toBe("112px");
    expect(rows()).toHaveLength(3);
  });

  it("draw a backup slide a little narrower than the others at any width", async () => {
    const { container } = await setup({ slides: 3, backup: [2] });
    grip().focus();
    press("End");
    expect(listOf(container).style.getPropertyValue("--fs-bw")).toBe(`${backupWidth(312) + FRAME}px`);
    const thumbs = [...container.querySelectorAll<HTMLElement>(".ks-thumb")].map((t) => t.style.width);
    expect(thumbs).toEqual(["312px", "312px", `${backupWidth(312)}px`]);
  });
});

describe("a right click on the empty space of the list", () => {
  it("opens the filmstrip's own menu, and a right click on a slide still opens the slide's", async () => {
    const { ui, container } = await setup({ slides: 3 });
    const list = listOf(container);
    act(() => void fireEvent.contextMenu(list, { clientX: 30, clientY: 400 }));
    expect(ui.state.contextMenu).toEqual({ kind: "filmstrip", x: 30, y: 400 });
    act(() => ui.openContextMenu(null));
    act(() => void fireEvent.contextMenu(rows()[1]!, { clientX: 30, clientY: 100 }));
    expect(ui.state.contextMenu?.kind).toBe("slide");
  });
});
