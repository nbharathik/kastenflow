import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Menu, openRowMenu, type MenuEntry } from "./Menu";

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** Lays out the menu's button at `button` and the open menu at 224 × 300 (jsdom has no layout). */
function layout(button: DOMRect) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "menu") return box(0, 0, 224, 300);
    if (this.getAttribute("aria-label") === "More") return button;
    return box(0, 0, 0, 0);
  });
}

function open() {
  render(
    <Menu label="More" float align="left" items={[{ label: "One", onSelect: () => {} }]}>
      •••
    </Menu>,
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  return screen.getByRole("menu", { name: "More" }).parentElement!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a floating menu", () => {
  it("opens below its button, from the button's left edge", () => {
    layout(box(180, 100, 20, 20));
    const menu = open();
    expect(menu.className).toContain("fixed");
    expect([menu.style.left, menu.style.top]).toEqual(["180px", "124px"]);
    expect(screen.getByRole("menuitem", { name: "One" })).toBeTruthy();
  });

  it("opens upwards near the window's bottom and stays inside its right edge", () => {
    // jsdom's window is 1024 × 768.
    layout(box(900, 700, 20, 20));
    const menu = open();
    expect([menu.style.left, menu.style.top]).toEqual([`${1024 - 8 - 224}px`, `${700 - 4 - 300}px`]);
  });
});

describe("a menu from the keyboard", () => {
  const items = (picked: string[]) =>
    ["Rename", "Duplicate", "Delete"].map((label) => ({ label, onSelect: () => picked.push(label) }));

  it("opens on Enter or ArrowDown with its first item focused, and the arrows go round", async () => {
    const picked: string[] = [];
    render(<Menu label="Actions" items={items(picked)}>…</Menu>);
    const button = screen.getByRole("button", { name: "Actions" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    button.focus();
    await act(async () => fireEvent.keyDown(button, { key: "ArrowDown" }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    await act(async () => fireEvent.click(document.activeElement!));
    expect(picked).toEqual(["Delete"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("gives focus back to its button on Escape", async () => {
    render(<Menu label="Actions" items={items([])}>…</Menu>);
    const button = screen.getByRole("button", { name: "Actions" });
    // A click from the keyboard carries no pointer detail.
    await act(async () => fireEvent.click(button, { detail: 0 }));
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("opened by the pointer, takes the focus itself, so the arrows work", async () => {
    render(<Menu label="Actions" items={items([])}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions" }), { detail: 1 }));
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
  });

  it("opens a row's own menu on right-click, in place of the browser's", () => {
    const picked = vi.fn();
    render(
      <div data-testid="row" onContextMenu={openRowMenu}>
        <span>A page</span>
        <Menu label="More for A page" items={[{ label: "Rename", onSelect: picked }]}>
          …
        </Menu>
      </div>,
    );
    const shown = fireEvent.contextMenu(screen.getByText("A page"));
    expect(shown).toBe(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(picked).toHaveBeenCalled();

    // A row without a menu keeps the browser's.
    render(<div data-testid="plain" onContextMenu={openRowMenu}>Plain</div>);
    expect(fireEvent.contextMenu(screen.getByText("Plain"))).toBe(true);
  });
});

describe("headings, submenus and a tall menu", () => {
  const withSub = (picked: string[]): MenuEntry[] => [
    { heading: "Page" },
    { label: "Rename", onSelect: () => picked.push("Rename") },
    "divider",
    { heading: "Plugins" },
    { label: "Export", submenu: [{ label: "As PDF", onSelect: () => picked.push("As PDF") }, { label: "As image", onSelect: () => picked.push("As image") }] },
    { label: "Delete", onSelect: () => picked.push("Delete") },
  ];

  it("shows a heading over a group and passes it by with the arrows", async () => {
    render(<Menu label="Actions" items={withSub([])}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions" }), { detail: 0 }));
    expect(screen.getByText("Page")).toBeTruthy();
    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Rename", "Export", "Delete"]);
    // Rename first, then the submenu's row: the headings are no stops.
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Export" }));
  });

  it("opens a submenu with → and closes it with ←, the focus following", async () => {
    render(<Menu label="Actions" items={withSub([])}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions" }), { detail: 0 }));
    const row = screen.getByRole("menuitem", { name: "Export" });
    expect(row.getAttribute("aria-haspopup")).toBe("menu");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    row.focus();
    await act(async () => fireEvent.keyDown(row, { key: "ArrowRight" }));
    const sub = screen.getByRole("menu", { name: "Export" });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "As PDF" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "As image" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "As PDF" }));
    await act(async () => fireEvent.keyDown(sub.querySelector("[role=menuitem]")!, { key: "ArrowLeft" }));
    expect(screen.queryByRole("menu", { name: "Export" })).toBeNull();
    expect(document.activeElement).toBe(row);
    // The menu itself is still open.
    expect(screen.getByRole("menu", { name: "Actions" })).toBeTruthy();
  });

  it("opens a submenu on a click, and Escape closes only the submenu", async () => {
    render(<Menu label="Actions" items={withSub([])}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions" }), { detail: 0 }));
    const row = screen.getByRole("menuitem", { name: "Export" });
    await act(async () => fireEvent.click(row));
    expect(screen.getByRole("menu", { name: "Export" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    });
    expect(screen.queryByRole("menu", { name: "Export" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Actions" })).toBeTruthy();
    expect(document.activeElement).toBe(row);
  });

  it("runs a submenu's item and closes the whole menu", async () => {
    const picked: string[] = [];
    render(<Menu label="Actions" items={withSub(picked)}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions" }), { detail: 0 }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Export" })));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "As image" })));
    expect(picked).toEqual(["As image"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("scrolls inside the window when it is taller than it", async () => {
    render(<Menu label="Actions" items={withSub([])}>…</Menu>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions" }), { detail: 0 }));
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(menu.className).toContain("max-h-[calc(100vh-2rem)]");
    expect(menu.className).toContain("overflow-auto");
  });
});

