import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { chromeOf } from "../chrome/chrome.ts";
import { runCommand } from "../commands/index.ts";
import type { DeckFavourite } from "../host.ts";
import { MemoryHost } from "../memory-host.ts";
import { button, click } from "../menus/testing.ts";
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
      const menu = screen.getByRole("menu", { name: "Menu" });
      expect(within(menu).getAllByRole("menuitem").map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual(["File", "Edit", "View", "Insert", "Format", "Slide", "Arrange", "Tools", "Help"]);
      click(within(menu).getByRole("menuitem", { name: "File" }));
      expect(screen.getByRole("menuitem", { name: /^Page setup/ })).toBeTruthy();
    } finally {
      if (saved) Object.defineProperty(proto, "clientWidth", saved);
      else Reflect.deleteProperty(proto, "clientWidth");
    }
  });
});

// The palette itself is drawn with the other dialogs (see dialogs/palette.test.tsx): the bar only has the button that opens it.
describe("the search button of the bar", () => {
  it("opens the command palette on all of it, and says the keys in its tip", async () => {
    const { ui } = await setup();
    expect(ui.state.dialog).toBeNull();
    click(button("Command palette"));
    expect(ui.state.dialog).toBe("insert");
    expect(chromeOf(ui).takePalette()).toBe("all");
    expect(button("Command palette").getAttribute("data-tip")).toMatch(/Ctrl\+Shift\+P|⇧⌘P/);
  });

  it("is also opened by the command for Alt+/, on the commands, from anywhere", async () => {
    const { session, ui } = await setup();
    await act(async () => runCommand("view.menu-search", { session, ui }));
    expect(ui.state.dialog).toBe("insert");
    expect(chromeOf(ui).takePalette()).toBe("commands");
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
