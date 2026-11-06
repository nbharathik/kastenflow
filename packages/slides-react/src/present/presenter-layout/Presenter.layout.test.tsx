import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { plainDeck } from "../../render/testing/decks.ts";
import { Presenter } from "../Presenter.tsx";
import { LAYOUT_KEY } from "./layout.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deck: Deck = { ...plainDeck([]).deck, title: "The talk", slides: [slide("a", { notes: "One" }), slide("b", { steps: 3 }), slide("c"), slide("d")] };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const view = (h = 0) => <Presenter deck={deck} imageUrl={() => undefined} position={{ h, v: 0, f: -1 }} paused={false} since={Date.now()} onGo={() => {}} />;
const render = (ui: React.ReactElement) => act(async () => root.render(ui));
const click = (el: Element | null | undefined) => act(async () => void (el as HTMLElement | null | undefined)?.click());
const has = (selector: string) => host.querySelector(selector) !== null;
const items = () => [...host.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
const item = (label: string) => items().find((i) => i.textContent?.includes(label));
const stored = () => JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Record<string, unknown> | null;
async function openMenu() {
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Layout"));
}

describe("the layout of the presenter's view", () => {
  it("has the three panels, the two splitters and the clock by default", async () => {
    await render(view());
    expect(has(".ks-pv-now")).toBe(true);
    expect(has(".ks-pv-next")).toBe(true);
    expect(has(".ks-pv-notes")).toBe(true);
    expect(host.querySelectorAll('[role="separator"]').length).toBe(2);
    expect(has('[data-fact="timer"]')).toBe(true);
    expect(has(".ks-pv-then")).toBe(false);
  });

  it("opens a Layout menu with the toggles, the presets and a reset, and closes it with Escape", async () => {
    await render(view());
    await openMenu();
    expect(items().map((i) => i.textContent?.replace("✓", ""))).toEqual(["Current slide", "Next slide", "Notes", "Timer and clock", "Next two steps", "Balanced", "Big notes", "Big slides", "Notes only", "Swap sides", "Reset layout"]);
    expect(item("Notes")?.getAttribute("aria-checked")).toBe("true");
    await act(async () => void item("Notes")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(has('[role="menu"]')).toBe(false);
  });

  it("hides a panel, and the others take its room, down to one splitter and then none", async () => {
    await render(view());
    await openMenu();
    await click(item("Next slide"));
    expect(has(".ks-pv-next")).toBe(false);
    expect(host.querySelectorAll('[role="separator"]').length).toBe(1);
    await click(item("Current slide"));
    expect(has(".ks-pv-now")).toBe(false);
    expect(host.querySelectorAll('[role="separator"]').length).toBe(0);
    expect(has(".ks-pv-notes")).toBe(true);
  });

  it("keeps the last panel on", async () => {
    await render(view());
    await openMenu();
    await click(item("Current slide"));
    await click(item("Next slide"));
    await click(item("Notes"));
    expect(has(".ks-pv-notes")).toBe(true);
    expect(item("Notes")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the controls when the current slide is hidden", async () => {
    await render(view());
    await openMenu();
    await click(item("Notes only"));
    expect(has(".ks-pv-now")).toBe(false);
    expect(has(".ks-pv-controls")).toBe(true);
  });

  it("hides the timer and clock row", async () => {
    await render(view());
    await openMenu();
    await click(item("Timer and clock"));
    expect(has('[data-fact="timer"]')).toBe(false);
    expect(has('[data-fact="clock"]')).toBe(false);
  });

  it("shows the next two slides under the next one when asked", async () => {
    await render(view(0));
    await openMenu();
    await click(item("Next two steps"));
    expect(host.querySelectorAll(".ks-pv-then .ks-show-scroll-frame").length).toBe(2);
    await render(view(3));
    expect(has(".ks-pv-then")).toBe(false);
    await render(view(2));
    expect(host.querySelectorAll(".ks-pv-then .ks-show-scroll-frame").length).toBe(0);
  });

  it("puts the side column first when the sides are swapped", async () => {
    await render(view());
    const order = () => [...host.querySelector(".ks-pv-body")!.children].map((c) => c.className.split(" ")[0]);
    expect(order()).toEqual(["ks-pv-now", "ks-pv-splitter", "ks-pv-side"]);
    await openMenu();
    await click(item("Swap sides"));
    expect(order()).toEqual(["ks-pv-side", "ks-pv-splitter", "ks-pv-now"]);
  });

  it("moves a splitter with the keys, and goes back with a double-click", async () => {
    await render(view());
    const bar = host.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
    await act(async () => void bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })));
    expect(bar.getAttribute("aria-valuenow")).toBe("52");
    expect(host.querySelector<HTMLElement>(".ks-pv-body")!.style.gridTemplateColumns).toContain("52.00fr");
    await act(async () => void bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
  });

  it("keeps the layout, brings it back, and forgets it on Reset layout", async () => {
    await render(view());
    await openMenu();
    await click(item("Big slides"));
    expect(stored()).toMatchObject({ v: 1, preset: "bigSlides" });
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(view());
    expect(host.querySelector('[role="separator"][aria-orientation="vertical"]')?.getAttribute("aria-valuenow")).toBe("78");
    await openMenu();
    await click(item("Reset layout"));
    expect(stored()).toMatchObject({ preset: "balanced", split: 0.62 });
  });

  it("starts from the default when what was kept is bad", async () => {
    localStorage.setItem(LAYOUT_KEY, "{broken");
    await render(view());
    expect(host.querySelectorAll('[role="separator"]').length).toBe(2);
  });

  it("does not move the talk on when the menu is used with the keys", async () => {
    let moved = 0;
    await render(<Presenter deck={deck} imageUrl={() => undefined} position={{ h: 0, v: 0, f: -1 }} paused={false} since={Date.now()} onGo={() => void (moved += 1)} />);
    await openMenu();
    await act(async () => void item("Notes")?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
    expect(moved).toBe(0);
  });
});
