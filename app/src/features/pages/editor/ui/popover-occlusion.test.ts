import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { covered, useOcclusion } from "../../../browser/occlusion";
import { Popover, type MenuSection } from "./popover";

const anchor = () => ({ left: 10, top: 10, right: 20, bottom: 20 });
const AREA = { left: 200, top: 100, right: 800, bottom: 600 };
const holds = () => Object.keys(useOcclusion.getState().holds);

const sections = (): MenuSection[] => [{ items: [{ key: "a", label: "A" }, { key: "more", label: "More", submenu: () => [{ items: [{ key: "deep", label: "Deep" }] }] }] }];

let open: Popover | null = null;

beforeEach(() => {
  useOcclusion.setState({ holds: {}, areas: {} });
  // jsdom lays nothing out: every menu takes the same place, over the browser's area.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const inside = this.classList.contains("kasten-menu");
    const box = inside ? { left: 300, top: 150, right: 500, bottom: 350 } : { left: 0, top: 0, right: 0, bottom: 0 };
    return { ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON: () => ({}) };
  });
});

afterEach(() => {
  open?.close();
  open = null;
  vi.restoreAllMocks();
});

describe("an editor menu over a browser tab's page", () => {
  it("covers the area it takes while it is open, so the page steps aside, and not after it closes", () => {
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(false);
    open = new Popover(sections(), { anchor });
    expect(holds()).toHaveLength(1);
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(true);
    open.close();
    expect(holds()).toEqual([]);
    expect(covered(useOcclusion.getState().holds, AREA)).toBe(false);
  });

  it("covers a flyout too, and lets go of it when only the flyout closes", () => {
    open = new Popover(sections(), { anchor, ownKeys: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.querySelectorAll(".kasten-menu")).toHaveLength(2);
    expect(holds()).toHaveLength(2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(holds()).toHaveLength(1);
    open.close();
    expect(holds()).toEqual([]);
  });

  it("is let go once however often it is closed", () => {
    open = new Popover(sections(), { anchor });
    open.close();
    open.close();
    expect(holds()).toEqual([]);
  });
});
