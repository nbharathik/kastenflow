import { describe, expect, it } from "vitest";

import { placePopover } from "./place";

const view = { width: 1000, height: 700 };
const size = { width: 320, height: 240 };
const chip = (left: number, top: number) => ({ left, top, width: 120, height: 22 });

describe("where an event's popover goes", () => {
  it("opens under its chip, with a little room", () => {
    expect(placePopover(chip(200, 100), size, view)).toEqual({ left: 200, top: 128 });
  });

  it("opens over its chip when there is no room below", () => {
    expect(placePopover(chip(200, 600), size, view)).toEqual({ left: 200, top: 600 - 6 - 240 });
  });

  it("stays inside the window at the sides", () => {
    expect(placePopover(chip(900, 100), size, view).left).toBe(1000 - 8 - 320);
    expect(placePopover(chip(-50, 100), size, view).left).toBe(8);
  });

  it("stays inside a window too small for it", () => {
    const place = placePopover(chip(10, 200), { width: 320, height: 800 }, view);
    expect(place.top).toBe(8);
  });
});
