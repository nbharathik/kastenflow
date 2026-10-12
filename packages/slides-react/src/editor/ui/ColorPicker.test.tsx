import type { Theme } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { recentColours } from "../chrome/recents.ts";
import { ColorPicker } from "./ColorPicker.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(value: string | null = null) {
  const theme: Theme = (await newDeck()).deck.theme;
  const onPick = vi.fn();
  const view = render(<ColorPicker theme={theme} value={value} onPick={onPick} noneLabel="Automatic" />);
  return { theme, onPick, view };
}

describe("the colour palette", () => {
  it("has the theme's colours with a row of shades under each, then the standard colours", async () => {
    await open();
    const theme = screen.getByRole("group", { name: "Theme colours" });
    expect(within(theme).getAllByRole("button")).toHaveLength(30);
    expect(within(theme).getByRole("button", { name: "accent1" })).toBeTruthy();
    expect(within(theme).getByRole("button", { name: "accent1, lighter" })).toBeTruthy();
    expect(within(theme).getByRole("button", { name: "accent1, darker" })).toBeTruthy();
    const standard = screen.getByRole("group", { name: "Standard colours" });
    expect(within(standard).getAllByRole("button")).toHaveLength(70);
    expect(within(standard).getByRole("button", { name: "#ff0000" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Recent colours" })).toBeNull();
  });

  it("picks a colour of the theme by its name, so it follows the theme, and none with the first row", async () => {
    const { onPick } = await open();
    fireEvent.click(screen.getByRole("button", { name: "accent3" }));
    expect(onPick).toHaveBeenLastCalledWith("accent3");
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("marks the colour in use, whether it is given as a theme colour or as its value", async () => {
    const { theme } = await open("accent2");
    const marked = () => [...document.querySelectorAll(".ks-swatch.is-on")].map((s) => s.getAttribute("aria-label"));
    expect(marked()).toContain("accent2");
    cleanup();
    render(<ColorPicker theme={theme} value="#ff0000" onPick={() => {}} />);
    expect(marked()).toEqual(["#ff0000"]);
  });

  it("remembers a colour picked as a value, and offers it first next time; a theme colour is not remembered", async () => {
    const { onPick } = await open();
    fireEvent.click(screen.getByRole("button", { name: "accent1" }));
    expect(recentColours()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "#4a86e8" }));
    expect(onPick).toHaveBeenLastCalledWith("#4a86e8");
    expect(recentColours()).toEqual(["#4a86e8"]);
    cleanup();
    await open();
    const recent = screen.getByRole("group", { name: "Recent colours" });
    expect(within(recent).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Recent #4a86e8"]);
  });

  it("takes a typed value, tidied up, only when it is a colour", async () => {
    const { onPick } = await open();
    const box = screen.getByRole("textbox", { name: "Colour as hex" });
    const use = screen.getByRole("button", { name: "Use" }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "12zz" } });
    expect(use.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "0A0B0C" } });
    expect(use.disabled).toBe(false);
    fireEvent.submit(box.closest("form")!);
    expect(onPick).toHaveBeenLastCalledWith("#0a0b0c");
    fireEvent.change(box, { target: { value: "#abc" } });
    fireEvent.click(use);
    expect(onPick).toHaveBeenLastCalledWith("#aabbcc");
  });

  it("is one stop for Tab, and the arrow keys move over the swatches and from grid to grid", async () => {
    await open();
    const stops = () => document.querySelectorAll(".ks-swatch[tabindex='0']");
    expect(stops()).toHaveLength(1);
    const first = screen.getByRole("button", { name: "text1" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("text2");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("text2, lighter");
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toBe(document.activeElement);
    // Down through the shades and out of the theme's grid into the standard one.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("text2, darker");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("#434343");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("#ffffff");
  });

  it("opens a colour square and a hue bar, which fill in the box as they move, and are used with Use", async () => {
    const { onPick } = await open();
    expect(screen.queryByRole("slider", { name: "Hue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick on a colour square" }));
    const hue = screen.getByRole("slider", { name: "Hue" });
    const box = screen.getByRole("textbox", { name: "Colour as hex" }) as HTMLInputElement;
    fireEvent.keyDown(hue, { key: "ArrowRight", shiftKey: true });
    expect(box.value).toMatch(/^#[0-9a-f]{6}$/);
    const square = screen.getByRole("slider", { name: "Saturation and brightness" });
    fireEvent.keyDown(square, { key: "ArrowLeft", shiftKey: true });
    const moved = box.value;
    fireEvent.keyDown(square, { key: "ArrowDown", shiftKey: true });
    expect(box.value).not.toBe(moved);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenCalledWith(box.value);
  });

  it("has an eyedropper only where the browser has one, and picks what it is pointed at", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Pick from the screen" })).toBeNull();
    cleanup();
    class Dropper {
      open = vi.fn(async () => ({ sRGBHex: "#12AB34" }));
    }
    vi.stubGlobal("EyeDropper", Dropper);
    const { onPick } = await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick from the screen" })));
    expect(onPick).toHaveBeenCalledWith("#12ab34");
    expect(recentColours()).toEqual(["#12ab34"]);
  });

  it("does nothing when the eyedropper is dismissed", async () => {
    class Dropper {
      open = vi.fn(async () => {
        throw new DOMException("cancelled", "AbortError");
      });
    }
    vi.stubGlobal("EyeDropper", Dropper);
    const { onPick } = await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick from the screen" })));
    expect(onPick).not.toHaveBeenCalled();
  });
});
