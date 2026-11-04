// @vitest-environment jsdom
// Popovers are drawn in a layer on the body: placed by window coordinates, kept inside the window, wearing the look of where they opened,
// and closed innermost first.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MenuItem, Menu } from "./Menu.tsx";
import { Popover } from "./Popover.tsx";

const WIDTH = 224;
const HEIGHT = 200;
const sizes = { w: WIDTH, h: HEIGHT };
let watchers: (() => void)[] = [];

beforeEach(() => {
  sizes.w = WIDTH;
  sizes.h = HEIGHT;
  watchers = [];
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => sizes.w });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => sizes.h });
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: () => void) {}
    observe() {
      watchers.push(this.callback);
    }
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  Reflect.deleteProperty(globalThis, "ResizeObserver");
});

const items: MenuItem[] = [
  { id: "one", label: "One", run: () => {} },
  { id: "more", label: "More", items: [{ id: "deep", label: "Deep", run: () => {} }] },
];
const near = { left: 300, top: 10, right: 340, bottom: 38 };
const boxOf = (name: string) => screen.getByRole("menu", { name }).closest<HTMLElement>(".ks-popover")!;

describe("where a popover is drawn", () => {
  it("is a layer on the body, outside the container it was opened from", () => {
    const { container } = render(
      <div className="ks-editor" style={{ containerType: "inline-size", overflow: "hidden", width: 360 }}>
        <div className="ks-titlebar">
          <Menu items={items} anchor={near} onClose={() => {}} label="Slideshow options" />
        </div>
      </div>,
    );
    const box = boxOf("Slideshow options");
    expect(container.contains(box)).toBe(false);
    expect(box.closest(".ks-popover-layer")?.parentElement).toBe(document.body);
    expect(box.closest(".ks-editor")).toBeNull();
  });

  it("stays inside the window when opened from a button at the right edge of a narrow container", () => {
    render(
      <div style={{ width: 360, overflow: "hidden" }}>
        <Menu items={items} anchor={near} onClose={() => {}} label="Slideshow options" />
      </div>,
    );
    const box = boxOf("Slideshow options");
    const left = Number.parseFloat(box.style.left);
    const top = Number.parseFloat(box.style.top);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(left + WIDTH).toBeLessThanOrEqual(window.innerWidth - 4);
    expect(top).toBe(near.bottom + 4);
    expect(top + HEIGHT).toBeLessThanOrEqual(window.innerHeight);
  });

  it("rises above a button at the bottom edge", () => {
    render(<Menu items={items} anchor={{ left: 20, top: 560, right: 60, bottom: 588 }} onClose={() => {}} label="Low" />);
    const box = boxOf("Low");
    expect(box.getAttribute("data-placement")).toBe("top");
    expect(Number.parseFloat(box.style.top) + HEIGHT).toBeLessThanOrEqual(560);
  });

  it("is placed again when its content grows after it opened (rows that arrive late)", () => {
    render(<Menu items={items} anchor={{ left: 20, top: 10, right: 60, bottom: 38 }} onClose={() => {}} label="Late" />);
    const box = boxOf("Late");
    expect(box.style.top).toBe("42px");
    expect(box.getAttribute("data-placement")).toBeNull();
    sizes.h = 580;
    act(() => watchers.forEach((watch) => watch()));
    expect(box.getAttribute("data-placement")).toBe("top");
  });

  it("wears the colours, theme and density of the place it was opened from", () => {
    render(
      <div data-theme="dark" data-density="compact">
        <div style={{ "--ks-raised": "#2d2c2b", "--ks-ink": "#e6e4df" } as CSSProperties}>
          <Popover anchor={near} onClose={() => {}} label="Colours">
            <p>inside</p>
          </Popover>
        </div>
      </div>,
    );
    const scope = screen.getByRole("dialog", { name: "Colours" }).closest<HTMLElement>(".ks-popover-scope")!;
    expect(scope.getAttribute("data-theme")).toBe("dark");
    expect(scope.getAttribute("data-density")).toBe("compact");
    expect(scope.style.getPropertyValue("--ks-raised")).toBe("#2d2c2b");
    expect(scope.style.getPropertyValue("--ks-ink")).toBe("#e6e4df");
  });
});

describe("what a popover says it is", () => {
  it("is nothing of its own for a menu, whose list is named; a panel stays a dialog", () => {
    render(
      <>
        <Menu items={items} anchor={near} onClose={() => {}} label="Slideshow options" />
        <Popover anchor={near} onClose={() => {}} label="Colours">
          <p>inside</p>
        </Popover>
      </>,
    );
    expect(boxOf("Slideshow options").getAttribute("role")).toBe("none");
    expect(boxOf("Slideshow options").hasAttribute("aria-label")).toBe(false);
    expect(screen.queryAllByRole("dialog").map((one) => one.getAttribute("aria-label"))).toEqual(["Colours"]);
  });

  it("names a sub-menu after its row", () => {
    render(<Menu items={items} anchor={near} onClose={() => {}} label="Options" />);
    fireEvent.click(screen.getByRole("menuitem", { name: "More" }));
    expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
  });
});

describe("closing", () => {
  it("closes only the innermost menu on Escape", () => {
    const outer = vi.fn();
    render(<Menu items={items} anchor={near} onClose={outer} label="Options" />);
    fireEvent.click(screen.getByRole("menuitem", { name: "More" }));
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("does not take a press inside a sub-menu for a press outside its menu, but a press elsewhere closes both", () => {
    const outer = vi.fn();
    render(<Menu items={items} anchor={near} onClose={outer} label="Options" />);
    fireEvent.click(screen.getByRole("menuitem", { name: "More" }));
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Deep" }));
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.pointerDown(document.body);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("is not clipped by its parent: a sub-menu is a sibling of the menu it opened from", () => {
    render(<Menu items={items} anchor={near} onClose={() => {}} label="Options" />);
    fireEvent.click(screen.getByRole("menuitem", { name: "More" }));
    expect(boxOf("Options").contains(boxOf("More"))).toBe(false);
  });
});
