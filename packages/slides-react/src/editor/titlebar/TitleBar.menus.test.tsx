import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { runCommand } from "../commands/index.ts";
import type { DeckFavourite } from "../host.ts";
import { MemoryHost } from "../memory-host.ts";
import { button, click, nextFrame } from "../menus/testing.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { TitleBar } from "./TitleBar.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup(host: MemoryHost = new MemoryHost()) {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 10_000 });
  const ui = new EditorUi();
  render(<TitleBar session={session} ui={ui} />);
  return { session, ui, host };
}

describe("the menus in the title bar", () => {
  it("are File to Help, in the same row as the deck's name", async () => {
    await setup();
    const bar = screen.getByRole("menubar", { name: "Menus" });
    expect(bar.closest(".ks-titlebar")).toBeTruthy();
    expect(within(bar).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["File", "Edit", "View", "Insert", "Format", "Slide", "Arrange", "Tools", "Help"]);
    // The name comes before them and the buttons after.
    const order = [...document.querySelectorAll(".ks-titlebar > *")].map((el) => el.className);
    expect(order.findIndex((c) => c.includes("ks-title-block"))).toBeLessThan(order.findIndex((c) => c.includes("ks-menubar")));
    expect(order.findIndex((c) => c.includes("ks-menubar"))).toBeLessThan(order.findIndex((c) => c.includes("ks-present")));
  });

  it("fold into one Menu button in a window too narrow for them, with the same menus as sub-menus", async () => {
    const proto = HTMLElement.prototype;
    const saved = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 800 });
    try {
      await setup();
      expect(screen.queryByRole("menuitem", { name: "File" })).toBeNull();
      click(screen.getByRole("menuitem", { name: "Menu" }));
      const menu = screen.getByRole("dialog", { name: "Menu" });
      expect(within(menu).getAllByRole("menuitem").map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual(["File", "Edit", "View", "Insert", "Format", "Slide", "Arrange", "Tools", "Help"]);
      click(within(menu).getByRole("menuitem", { name: "File" }));
      expect(screen.getByRole("menuitem", { name: /^Page setup/ })).toBeTruthy();
    } finally {
      if (saved) Object.defineProperty(proto, "clientWidth", saved);
      else Reflect.deleteProperty(proto, "clientWidth");
    }
  });
});

describe("the search over the menus", () => {
  it("finds a row of any menu by its name and runs it with Enter", async () => {
    const { ui } = await setup();
    click(button("Search the menus"));
    await nextFrame();
    const box = screen.getByRole("combobox", { name: "Search the menus" });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "page setup" } });
    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toContain("Page setup");
    expect(options[0]?.textContent).toContain("File");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(ui.state.dialog).toBe("page");
    expect(screen.queryByRole("combobox", { name: "Search the menus" })).toBeNull();
  });

  it("moves over what it found with the arrow keys, and runs a row clicked", async () => {
    const { session } = await setup();
    click(button("Search the menus"));
    await nextFrame();
    const box = screen.getByRole("combobox", { name: "Search the menus" });
    fireEvent.change(box, { target: { value: "new slide" } });
    expect(box.getAttribute("aria-activedescendant")).toBe("ks-menu-hit-0");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe("ks-menu-hit-1");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.getAttribute("aria-activedescendant")).toBe("ks-menu-hit-0");
    const slides = session.deck.slides.length;
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(session.deck.slides.length).toBe(slides + 1);
  });

  it("says when nothing is called what was typed, and does not run a row that cannot be done now", async () => {
    const { session } = await setup();
    click(button("Search the menus"));
    await nextFrame();
    const box = screen.getByRole("combobox", { name: "Search the menus" });
    fireEvent.change(box, { target: { value: "zebra" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Search the menus" }).textContent).toContain("Nothing in the menus");
    // Undo cannot be done on a deck nothing has been done to.
    fireEvent.change(box, { target: { value: "undo" } });
    const [undo] = screen.getAllByRole("option");
    expect(undo?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(session.state.canUndo).toBe(false);
    expect(screen.getByRole("combobox", { name: "Search the menus" })).toBeTruthy();
  });

  it("is opened by the command with its key, Alt+/, from anywhere", async () => {
    const { session, ui } = await setup();
    expect(screen.queryByRole("combobox", { name: "Search the menus" })).toBeNull();
    await act(async () => runCommand("view.menu-search", { session, ui }));
    await nextFrame();
    expect(screen.getByRole("combobox", { name: "Search the menus" })).toBeTruthy();
    expect(button("Search the menus").getAttribute("data-tip")).toMatch(/Alt\+\/|⌥\//);
  });

  it("closes on Escape and gives the focus back", async () => {
    await setup();
    const opener = button("Search the menus");
    opener.focus();
    click(opener);
    await nextFrame();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("combobox", { name: "Search the menus" })).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(opener);
  });
});

describe("the star beside the name", () => {
  /** A host with favourites, which can also be changed from outside, as the sidebar does. */
  function favouriteHost() {
    const host = new MemoryHost();
    let on = false;
    const watchers = new Set<() => void>();
    const favourite: DeckFavourite = {
      isOn: () => on,
      set: vi.fn((next: boolean) => {
        on = next;
        watchers.forEach((watch) => watch());
      }),
      watch: (onChange) => {
        watchers.add(onChange);
        return () => watchers.delete(onChange);
      },
    };
    Object.assign(host, { favourite });
    return { host, favourite, elsewhere: (next: boolean) => act(() => favourite.set(next)) };
  }

  it("is not there where the host has no favourites", async () => {
    await setup();
    expect(screen.queryByRole("button", { name: /favourites/ })).toBeNull();
  });

  it("makes the deck a favourite, shows it, and follows a change made elsewhere", async () => {
    const { host, favourite, elsewhere } = favouriteHost();
    await setup(host);
    const star = () => screen.getByRole("button", { name: /favourites/ });
    expect(star().getAttribute("aria-label")).toBe("Add to favourites");
    expect(star().getAttribute("aria-pressed")).toBe("false");
    click(star());
    expect(favourite.set).toHaveBeenLastCalledWith(true);
    expect(star().getAttribute("aria-label")).toBe("Remove from favourites");
    expect(star().getAttribute("aria-pressed")).toBe("true");
    elsewhere(false);
    expect(star().getAttribute("aria-pressed")).toBe("false");
    click(star());
    click(star());
    expect(favourite.set).toHaveBeenLastCalledWith(false);
  });
});
