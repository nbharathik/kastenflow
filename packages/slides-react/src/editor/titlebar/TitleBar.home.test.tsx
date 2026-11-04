// The Home button of the title bar: the way to the host's list of decks, beside Back (the place the person came from).

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchKey, keysOf } from "../commands/index.ts";
import { shortcutGroups } from "../dialogs/ShortcutsDialog.tsx";
import { button, click, openEditor } from "../menus/testing.ts";
import { TitleBar } from "./TitleBar.tsx";

afterEach(cleanup);

const altHome = (): KeyboardEvent => new KeyboardEvent("keydown", { key: "Home", code: "Home", altKey: true, cancelable: true });

async function setup() {
  const editor = await openEditor();
  render(<TitleBar session={editor.session} ui={editor.ui} />);
  return editor;
}

describe("Home", () => {
  it("is there only when the host has a home for decks, and goes there", async () => {
    const { ui } = await setup();
    expect(screen.queryByRole("button", { name: "Slides home" })).toBeNull();
    const home = vi.fn();
    // The host gives its actions to the editor once it is drawn.
    ui.actions = { home };
    await act(async () => {});
    click(button("Slides home"));
    expect(home).toHaveBeenCalledTimes(1);
  });

  it("says where it goes in words, and its keys in the tooltip", async () => {
    const { ui } = await setup();
    ui.actions = { home: () => {} };
    await act(async () => {});
    const home = button("Slides home");
    expect(home.textContent).toBe("Slides");
    expect(home.getAttribute("data-tip")).toBe(`Slides home (${keysOf("view.home")})`);
    expect(keysOf("view.home")).toMatch(/^(Alt\+Home|⌥Home)$/);
  });

  it("is a button of its own beside Back, which keeps meaning the place the person came from", async () => {
    const { ui } = await setup();
    const close = vi.fn();
    const home = vi.fn();
    ui.actions = { close, home };
    await act(async () => {});
    click(button("Back"));
    expect(close).toHaveBeenCalledTimes(1);
    expect(home).not.toHaveBeenCalled();
    click(button("Slides home"));
    expect(home).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("gives the window back before it goes, as Back does", async () => {
    const { ui } = await setup();
    const inside: boolean[] = [];
    ui.actions = { home: () => void inside.push(ui.state.fullScreen) };
    ui.setFullScreen(true);
    await act(async () => {});
    click(button("Slides home"));
    expect(inside).toEqual([false]);
    expect(ui.state.fullScreen).toBe(false);
  });

  it("is done by Alt+Home too, and listed with the other shortcuts", async () => {
    const { session, ui } = await setup();
    const home = vi.fn();
    ui.actions = { home };
    const press = altHome();
    expect(dispatchKey(press, { session, ui }, "canvas")).toBe(true);
    expect(press.defaultPrevented).toBe(true);
    expect(home).toHaveBeenCalledTimes(1);
    const listed = shortcutGroups().flatMap((group) => group.rows);
    expect(listed.find((row) => row.id === "view.home")?.combos[0]).toMatch(/^(Alt\+Home|⌥Home)$/);
  });

  it("does nothing on Alt+Home when the host has no home", async () => {
    const { session, ui } = await setup();
    ui.setFullScreen(true);
    dispatchKey(altHome(), { session, ui }, "canvas");
    expect(ui.state.fullScreen).toBe(true);
  });
});
