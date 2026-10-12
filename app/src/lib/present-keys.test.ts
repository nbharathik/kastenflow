// The presenter's keys, which a whiteboard and a page share.

import { describe, expect, it } from "vitest";

import { NEXT, PREVIOUS, presentAction, type PresentKey } from "./present-keys";

const press = (key: string, init: Partial<PresentKey> = {}): PresentKey => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });

describe("the presenter's keys", () => {
  it("go on with the arrows, Page Down, Enter, Space and N", () => {
    for (const key of ["ArrowRight", "ArrowDown", "PageDown", "Enter", " ", "n", "N"]) expect(presentAction(press(key)), key).toBe("next");
  });

  it("go back with the arrows, Page Up, Backspace, P and Shift+Space", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"]) expect(presentAction(press(key)), key).toBe("previous");
    expect(presentAction(press(" ", { shiftKey: true }))).toBe("previous");
  });

  it("jump with Home and End, and end with Escape", () => {
    expect(presentAction(press("Home"))).toBe("first");
    expect(presentAction(press("End"))).toBe("last");
    expect(presentAction(press("Escape"))).toBe("end");
  });

  it("leave every other key, and every chord, to the app", () => {
    for (const key of ["a", "d", "Tab", "F5", "Delete"]) expect(presentAction(press(key)), key).toBeNull();
    for (const chord of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(presentAction(press("ArrowRight", chord))).toBeNull();
    expect(presentAction(press("Escape", { ctrlKey: true }))).toBeNull();
    expect(presentAction(press("n", { isComposing: true }))).toBeNull();
  });

  it("leave Space and Enter to a button that has them, but not the arrows", () => {
    const button = document.createElement("button");
    const span = document.createElement("span");
    button.append(span);
    expect(presentAction(press(" ", { target: button }))).toBeNull();
    expect(presentAction(press("Enter", { target: span }))).toBeNull();
    expect(presentAction(press("ArrowRight", { target: button }))).toBe("next");
    expect(presentAction(press(" ", { target: document.createElement("div") }))).toBe("next");
  });

  it("are the sets the whiteboard's presenter reads, with nothing in both", () => {
    expect([...NEXT].sort()).toEqual(["ArrowDown", "ArrowRight", "Enter", "PageDown", " ", "n"].sort());
    expect([...PREVIOUS].sort()).toEqual(["ArrowLeft", "ArrowUp", "Backspace", "PageUp", "p"].sort());
    expect([...NEXT].filter((key) => PREVIOUS.has(key))).toEqual([]);
  });
});
