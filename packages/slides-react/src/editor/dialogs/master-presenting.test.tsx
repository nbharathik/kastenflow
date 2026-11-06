import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SHOW_KEYS } from "../../present/runtime/chrome.js";
import { runCommand } from "../commands/index.ts";
import { MenuBar } from "../menus/MenuBar.tsx";
import { bar, click, row } from "../menus/testing.ts";
import { SlideshowButton } from "../titlebar/SlideshowButton.tsx";
import { presentingKeys } from "./presenting-keys.ts";
import { mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

describe("Master", () => {
  it("is a command in the Slide menu that opens one dialog for what every slide shares", async () => {
    const kit = await mountDialogs({ dialog: null });
    render(<MenuBar session={kit.session} ui={kit.ui} />);
    click(bar("Slide"));
    fireEvent.click(row(/^Master…/));
    expect(kit.ui.state.dialog).toBe("master");
  });

  it("gathers the background, the logo, the graphics of each layout and the numbers", async () => {
    await mountDialogs({ dialog: "master" });
    const dialog = screen.getByRole("dialog", { name: "Master" });
    for (const section of ["Background", "Logo", "Theme graphics", "Footer and slide numbers"]) expect(within(dialog).getByRole("region", { name: section }), section).toBeTruthy();
    // One for the background and one for the logo: both are the buttons that were in the other dialogs.
    expect(within(dialog).getAllByRole("button", { name: "Choose image…" })).toHaveLength(2);
  });

  it("hides the theme's graphics on a layout as the box is ticked, as one step of undo", async () => {
    const kit = await mountDialogs({ dialog: "master" });
    const layout = kit.session.deck.theme.layouts.find((candidate) => candidate.hideMaster !== true)!;
    const box = screen.getByRole("checkbox", { name: `Hide on ${layout.label}` }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    const label = kit.session.state.undoLabel;
    fireEvent.click(box);
    expect(kit.session.deck.theme.layouts.find((candidate) => candidate.name === layout.name)?.hideMaster).toBe(true);
    expect((screen.getByRole("checkbox", { name: `Hide on ${layout.label}` }) as HTMLInputElement).checked).toBe(true);
    act(() => kit.session.undo());
    expect(kit.session.state.undoLabel).toBe(label);
    expect(kit.session.deck.theme.layouts.find((candidate) => candidate.name === layout.name)?.hideMaster).not.toBe(true);
  });

  it("gives every slide the background of the slide shown", async () => {
    const kit = await mountDialogs({ dialog: "master" });
    act(() => kit.session.slides.setBackground({ color: "accent1" }));
    fireEvent.click(screen.getByRole("button", { name: "Use this background on all slides" }));
    expect(kit.session.deck.slides.every((slide) => slide.background?.color === "accent1")).toBe(true);
  });

  it("edits a layout in the designer, closing itself first", async () => {
    const kit = await mountDialogs({ dialog: "master" });
    const layout = kit.session.deck.theme.layouts[0]!;
    fireEvent.click(screen.getByRole("button", { name: `Edit ${layout.label}…` }));
    expect(kit.ui.state.layoutDesign).toBe(layout.name);
  });

  it("links to the host's slide numbers only where the host gives them", async () => {
    const kit = await mountDialogs({ dialog: "master" });
    expect(screen.queryByRole("button", { name: "Slide numbers in every deck…" })).toBeNull();
    const open = vi.fn();
    act(() => {
      kit.ui.actions = { slideNumbers: open };
      kit.ui.openDialog(null);
      kit.ui.openDialog("master");
    });
    fireEvent.click(screen.getByRole("button", { name: "Slide numbers in every deck…" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("is not offered inside the designer of a layout, which has no master of the deck", async () => {
    const kit = await mountDialogs({ dialog: null });
    kit.ui.designing = true;
    await act(async () => runCommand("slide.master", kit));
    expect(kit.ui.state.dialog).toBeNull();
  });
});

describe("Presenting keys", () => {
  it("are the show's own list, then S, the timer's keys and Esc", () => {
    const keys = presentingKeys();
    expect(keys.slice(0, SHOW_KEYS.length).map((key) => [key.keys, key.what])).toEqual(SHOW_KEYS.map((key) => [...key]));
    const whats = keys.map((key) => key.what);
    expect(whats).toContain("Go to a slide by its number");
    expect(whats).toContain("Presenter view");
    expect(whats).toContain("Pause or start the timer (presenter view)");
    expect(whats).toContain("Start the timer again (presenter view)");
    expect(whats.at(-1)).toBe("Close what is open, then leave");
  });

  it("have a section of their own in the shortcuts dialog, which the search narrows like the rest", async () => {
    const kit = await mountDialogs({ dialog: "shortcuts" });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const section = within(dialog).getByRole("region", { name: "Presenting" });
    expect(section.textContent).toContain("Go to a slide by its number");
    expect(section.textContent).toContain("1 2 … Enter");
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search shortcuts" }), { target: { value: "timer" } });
    expect(within(dialog).getByRole("region", { name: "Presenting" }).textContent).toContain("Pause or start the timer");
    expect(within(dialog).queryByRole("region", { name: "Edit" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search shortcuts" }), { target: { value: "zebra" } });
    expect(within(dialog).queryByRole("region", { name: "Presenting" })).toBeNull();
    expect(dialog.textContent).toContain("No shortcut has that name.");
    expect(kit.errors).toEqual([]);
  });

  it("are on a card reached from the Slideshow button's options", async () => {
    const kit = await mountDialogs({ dialog: null });
    act(() => void (kit.ui.actions = { present: vi.fn() }));
    render(<SlideshowButton session={kit.session} ui={kit.ui} />);
    click(screen.getByRole("button", { name: "Slideshow options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Keys while presenting…" }));
    expect(kit.ui.state.dialog).toBe("presenting");
    const card = await screen.findByRole("dialog", { name: "Presenting" });
    expect(within(card).getByRole("region", { name: "Starting" }).textContent).toContain("Present from the beginning");
    expect(within(card).getByRole("region", { name: "During the show" }).textContent).toContain("Laser pointer");
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(kit.ui.state.dialog).toBeNull();
  });
});
