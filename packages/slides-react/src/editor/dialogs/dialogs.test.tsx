import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textBox } from "../factory.ts";
import { edit, mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const button = (name: string) => screen.getByRole("button", { name });

describe("Dialogs", () => {
  it("shows nothing until one is asked for, and follows what is asked for", async () => {
    const kit = await mountDialogs();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    edit(() => kit.ui.openDialog("about"));
    expect(screen.getByRole("dialog", { name: "About KastenFlow Slides" })).toBeTruthy();
    edit(() => kit.ui.openDialog("layouts"));
    expect(screen.queryByRole("dialog", { name: "About KastenFlow Slides" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Layouts" })).toBeTruthy();
    edit(() => kit.ui.openDialog(null));
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("closes a dialog with Escape", async () => {
    const kit = await mountDialogs({ dialog: "layouts" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("has a dialog for every name the window knows", async () => {
    const names = ["find", "layouts", "theme", "background", "shortcuts", "insert", "table", "link", "export", "about"] as const;
    for (const name of names) {
      const kit = await mountDialogs({ dialog: name, elements: [textBox({ x: 10, y: 10, w: 100, h: 40 }, "Hi")] });
      expect(document.querySelector("[role=dialog]"), name).not.toBeNull();
      expect(kit.errors).toEqual([]);
      cleanup();
    }
  });
});

describe("Layouts", () => {
  it("draws every layout of the theme with its name, and marks the slide's", async () => {
    const kit = await mountDialogs({ dialog: "layouts" });
    const list = screen.getByRole("listbox", { name: "Layouts" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(kit.session.deck.theme.layouts.length);
    expect(options.map((o) => o.textContent)).toEqual(kit.session.deck.theme.layouts.map((l) => l.label));
    expect(within(list).getByRole("option", { selected: true }).textContent).toBe("Blank");
    expect(options.every((o) => o.querySelector("svg.ks-wf") !== null)).toBe(true);
  });

  it("is one stop for Tab, at the slide's layout, and walks in rows of three with the arrows", async () => {
    await mountDialogs({ dialog: "layouts" });
    const options = within(screen.getByRole("listbox", { name: "Layouts" })).getAllByRole("option");
    expect(options.filter((o) => o.tabIndex === 0).map((o) => o.textContent)).toEqual(["Blank"]);
    options[0]?.focus();
    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[4]);
    fireEvent.keyDown(options[4] as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(options[3]);
    fireEvent.keyDown(options[3] as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("applies the layout that is clicked and closes", async () => {
    const kit = await mountDialogs({ dialog: "layouts" });
    fireEvent.click(screen.getByRole("option", { name: /Title \+ body/ }));
    expect(kit.session.slide.layout).toBe("title-body");
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.errors).toEqual([]);
  });

  it("closes without a step of undo when the layout is the one the slide has", async () => {
    const kit = await mountDialogs({ dialog: "layouts" });
    const before = kit.session.state.revision;
    fireEvent.click(screen.getByRole("option", { selected: true }));
    expect(kit.session.state.revision).toBe(before);
    expect(kit.ui.state.dialog).toBeNull();
  });
});

describe("Print or save as PDF", () => {
  it("prints each slide once, without notes, unless told otherwise", async () => {
    const print = vi.fn();
    const kit = await mountDialogs({ dialog: "export", prepare: () => undefined });
    act(() => void (kit.ui.actions = { print }));
    fireEvent.click(button("Print…"));
    expect(print).toHaveBeenCalledWith({ steps: "final", notes: false });
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("takes the choices made", async () => {
    const print = vi.fn();
    const kit = await mountDialogs({ dialog: "export" });
    act(() => void (kit.ui.actions = { print }));
    fireEvent.click(screen.getByRole("radio", { name: "A page for every step of a slide that has steps" }));
    fireEvent.click(screen.getByLabelText("Speaker notes under each slide (handout)"));
    fireEvent.click(button("Print…"));
    expect(print).toHaveBeenCalledWith({ steps: "each", notes: true });
  });

  it("cannot print where the host cannot", async () => {
    await mountDialogs({ dialog: "export" });
    expect(button("Print…").hasAttribute("disabled")).toBe(true);
  });
});

describe("The small dialogs", () => {
  it.each([
    ["about", "About KastenFlow Slides"],
  ] as const)("%s has a title, one sentence and a way out", async (name, title) => {
    const kit = await mountDialogs({ dialog: name });
    const dialog = screen.getByRole("dialog", { name: title });
    expect(within(dialog).getByRole("heading", { name: title })).toBeTruthy();
    expect(dialog.querySelectorAll("p")).toHaveLength(1);
    expect(dialog.querySelector("p")?.textContent?.endsWith(".")).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(kit.ui.state.dialog).toBeNull();
  });
});
