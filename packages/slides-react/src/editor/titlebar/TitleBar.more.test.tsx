// In a narrow bar the assistant and full screen buttons fold into one More menu instead of being clipped.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { button, click } from "../menus/testing.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { TitleBar } from "./TitleBar.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function narrow(width: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 10_000 });
  const ui = new EditorUi();
  render(<TitleBar session={session} ui={ui} />);
  return { session, ui };
}

describe("the title bar at a narrow width", () => {
  it("keeps the assistant and full screen buttons while there is room", async () => {
    await narrow(900);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(button("Assistant")).toBeTruthy();
    expect(button("Full screen")).toBeTruthy();
  });

  it("folds them into a More menu below 560 px, and nothing else goes missing", async () => {
    await narrow(480);
    expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(button("More").getAttribute("aria-haspopup")).toBe("menu");
    expect(button("Slideshow")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Deck title" })).toBeTruthy();
  });

  it("opens the menu in the popover layer on the page, outside the bar", async () => {
    await narrow(480);
    click(button("More"));
    const menu = screen.getByRole("menu");
    expect(document.querySelector(".ks-titlebar")?.contains(menu)).toBe(false);
    // Both can be on or off, so they are checkable items.
    expect(screen.getByRole("menuitemcheckbox", { name: /^Assistant/ })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: /^Full screen/ })).toBeTruthy();
  });

  it("does what the buttons do, and closes", async () => {
    const { ui } = await narrow(480);
    click(button("More"));
    click(screen.getByRole("menuitemcheckbox", { name: /^Assistant/ }));
    expect(ui.state.panel).toBe("ai");
    expect(screen.queryByRole("menu")).toBeNull();

    click(button("More"));
    click(screen.getByRole("menuitemcheckbox", { name: /^Full screen/ }));
    expect(ui.state.fullScreen).toBe(true);
  });

  it("says in the menu what is on", async () => {
    const { ui } = await narrow(480);
    act(() => ui.togglePanel("ai"));
    click(button("More"));
    expect(screen.getByRole("menuitemcheckbox", { name: /^Assistant/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("closes on Escape", async () => {
    await narrow(480);
    click(button("More"));
    expect(screen.getByRole("menu")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
