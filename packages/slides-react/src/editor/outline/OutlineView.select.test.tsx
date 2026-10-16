// Selecting text in the outline. Every row is a field of its own, and the words of separate fields cannot be selected together, so each
// field has its words again as plain text over it, while it is not the one being typed in. A press and a drag on those words select
// across rows; Ctrl+A and Edit, Select all take the words of every row; a press that does not leave its field is the field's.

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../commands/index.ts";
import { body, setup, title, type as typeInto } from "./outline-support.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

const ctrlA = { key: "a", code: "KeyA", ctrlKey: true };
const region = () => screen.getByRole("region", { name: "Outline" });
const ghosts = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".ks-ol-ghost")];
const ghostOf = (container: HTMLElement, place: number, kind: "title" | "body") => container.querySelectorAll(".ks-ol-row")[place - 1]!.querySelector<HTMLElement>(`.ks-ol-ghost.is-${kind}`)!;
/** The words of the fields that are in the selection, each as far as it is selected. */
const words = (): string[] => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  return [...selection.getRangeAt(0).cloneContents().querySelectorAll(".ks-ol-ghost")].map((ghost) => ghost.textContent ?? "").filter(Boolean);
};
const ALL = ["Talk", "Slide 2", "- Point 2", "Slide 3", "- Point 3"];

/** The selection a press and a drag made in the page's text, from one place in a ghost to another. */
function selectBetween(from: HTMLElement, fromAt: number, to: HTMLElement, toAt: number): void {
  window.getSelection()?.setBaseAndExtent(from.firstChild ?? from, fromAt, to.firstChild ?? to, toAt);
}

/** A press on a ghost, the selection it and the drag made, and the button coming up. */
function drag(from: HTMLElement, fromAt: number, to: HTMLElement, toAt: number): void {
  fireEvent.mouseDown(from, { button: 0 });
  selectBetween(from, fromAt, to, toAt);
  fireEvent.mouseUp(document);
}

describe("the words of a field, again as plain text", () => {
  it("are there for each title and body, hidden from assistive technology, and say what the field says", async () => {
    const { container } = await setup({ slides: 3 });
    expect(ghosts(container)).toHaveLength(6);
    for (const ghost of ghosts(container)) {
      expect(ghost.getAttribute("aria-hidden")).toBe("true");
      expect(ghost.tabIndex).toBe(-1);
    }
    expect(ghostOf(container, 2, "title").textContent).toBe("Slide 2");
    expect(ghostOf(container, 2, "body").textContent).toBe("- Point 2");
  });

  it("follow what is typed, and the deck's words when they change elsewhere", async () => {
    const { container, session, engine } = await setup({ slides: 2 });
    typeInto(title(2), "A new title");
    expect(ghostOf(container, 2, "title").textContent).toBe("A new title");
    typeInto(body(2), "- Typed\n- Two lines");
    expect(ghostOf(container, 2, "body").textContent).toBe("- Typed\n- Two lines");
    // Another field is changed by someone else: its ghost follows.
    const bodyEl = session.deck.slides[0]!.elements.find((e) => e.placeholder === "subtitle")!;
    act(() => void engine.apply("set_rich_text", { slide: session.deck.slides[0]!.id, id: bodyEl.id, text: { paragraphs: [{ runs: [{ t: "A subtitle" }] }] } }));
    expect(ghostOf(container, 1, "body").textContent).toBe("A subtitle");
  });

  it("are not made for a slide that has things on it but no text to use as a title", async () => {
    const { container, session } = await setup({ slides: 1 });
    act(() => void session.slides.add({ layout: "blank" }));
    act(() => void session.elements.insert([{ type: "shape", id: "", shape: "rect", x: 10, y: 10, w: 100, h: 100 } as never]));
    const rows = container.querySelectorAll(".ks-ol-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelector(".ks-ol-ghost")).toBeNull();
    expect(rows[0]!.querySelector(".ks-ol-ghost")).not.toBeNull();
  });
});

describe("Ctrl+A in the outline", () => {
  it("selects the words of every row, whichever field has the focus, and takes the field's own selection away", async () => {
    const { container } = await setup({ slides: 3 });
    title(2).focus();
    expect(fireEvent.keyDown(title(2), ctrlA)).toBe(false);
    expect(words()).toEqual(ALL);
    expect(document.activeElement).toBe(region());
    expect(container.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
    // From the body of a row the same.
    window.getSelection()?.removeAllRanges();
    body(3).focus();
    fireEvent.keyDown(body(3), ctrlA);
    expect(words()).toEqual(ALL);
  });

  it("works with the focus on the outline itself, and again after a selection is made", async () => {
    await setup({ slides: 2 });
    region().focus();
    fireEvent.keyDown(region(), ctrlA);
    expect(words()).toEqual(["Talk", "Slide 2", "- Point 2"]);
    fireEvent.keyDown(region(), ctrlA);
    expect(words()).toEqual(["Talk", "Slide 2", "- Point 2"]);
  });

  it("leaves the words typed and not yet written to be written, as any leaving of the field does", async () => {
    const { session } = await setup({ slides: 2 });
    title(2).focus();
    typeInto(title(2), "Typed then selected");
    fireEvent.keyDown(title(2), ctrlA);
    expect(session.deck.slides[1]!.elements.some((e) => JSON.stringify(e).includes("Typed then selected"))).toBe(true);
  });

  it("is the Select all of the Edit menu, the key and the right-click menu too, with the outline shown", async () => {
    const { session, ui } = await setup({ slides: 3 });
    ui.setView("outline");
    title(1).focus();
    await act(async () => runCommand("edit.select-all", { session, ui }));
    expect(words()).toEqual(ALL);
  });

  it("goes when Escape is pressed", async () => {
    await setup({ slides: 2 });
    title(1).focus();
    fireEvent.keyDown(title(1), ctrlA);
    expect(words()).not.toEqual([]);
    expect(fireEvent.keyDown(region(), { key: "Escape" })).toBe(false);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it("with nothing selected, Escape leaves the field for the outline, so a drag can begin anywhere; then it is not taken", async () => {
    await setup({ slides: 2 });
    title(1).focus();
    expect(fireEvent.keyDown(title(1), { key: "Escape" })).toBe(false);
    expect(document.activeElement).toBe(region());
    expect(fireEvent.keyDown(region(), { key: "Escape" })).toBe(true);
  });
});

describe("copying words selected across rows", () => {
  const copy = (clipboardData: { setData: (type: string, text: string) => void }) => fireEvent.copy(region(), { clipboardData });

  it("puts each field on a line of its own, once, as far as it is selected", async () => {
    const { container } = await setup({ slides: 4 });
    drag(ghostOf(container, 2, "title"), 6, ghostOf(container, 3, "body"), 7);
    const setData = vi.fn();
    expect(copy({ setData })).toBe(false);
    expect(setData).toHaveBeenCalledWith("text/plain", "2\n- Point 2\nSlide 3\n- Point");
  });

  it("puts everything on the clipboard after Ctrl+A, the empty subtitle left out", async () => {
    await setup({ slides: 3 });
    title(1).focus();
    fireEvent.keyDown(title(1), ctrlA);
    const setData = vi.fn();
    copy({ setData });
    expect(setData).toHaveBeenCalledWith("text/plain", "Talk\nSlide 2\n- Point 2\nSlide 3\n- Point 3");
  });

  it("leaves a selection inside one field to the browser", async () => {
    await setup({ slides: 2 });
    title(2).focus();
    title(2).setSelectionRange(0, 3);
    const setData = vi.fn();
    expect(copy({ setData })).toBe(true);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("a right press on the words of a field", () => {
  it("gives the field the focus, so the menu is the field's", async () => {
    const { container } = await setup({ slides: 2 });
    fireEvent.mouseDown(ghostOf(container, 2, "title"), { button: 2 });
    expect(document.activeElement).toBe(title(2));
  });
});

describe("a press on the words of a field that is not the one in use", () => {
  it("that ends where it began puts the caret there, in the field, and hands the selection to it", async () => {
    const { container } = await setup({ slides: 3 });
    const ghost = ghostOf(container, 2, "title");
    drag(ghost, 3, ghost, 3);
    expect(document.activeElement).toBe(title(2));
    expect([title(2).selectionStart, title(2).selectionEnd]).toEqual([3, 3]);
    // Nothing is left selected in the plain text over the fields.
    expect(container.querySelector(".ks-ol-ghost")).not.toBeNull();
    expect(window.getSelection()?.rangeCount ? (window.getSelection()?.anchorNode?.parentElement?.closest(".ks-ol-ghost") ?? null) : null).toBeNull();
  });

  it("that selected words within the field selects them in the field", async () => {
    const { container } = await setup({ slides: 3 });
    const ghost = ghostOf(container, 3, "body");
    drag(ghost, 2, ghost, 7);
    expect(document.activeElement).toBe(body(3));
    expect([body(3).selectionStart, body(3).selectionEnd]).toEqual([2, 7]);
    expect(body(3).value.slice(2, 7)).toBe("Point");
  });

  it("dragged backwards keeps its direction, so Shift and an arrow extend from the right end", async () => {
    const { container } = await setup({ slides: 2 });
    const ghost = ghostOf(container, 2, "title");
    drag(ghost, 6, ghost, 0);
    expect([title(2).selectionStart, title(2).selectionEnd, title(2).selectionDirection]).toEqual([0, 6, "backward"]);
  });

  it("that reached another row stays a selection of the words across the rows, and the outline holds the focus", async () => {
    const { container } = await setup({ slides: 4 });
    drag(ghostOf(container, 2, "title"), 6, ghostOf(container, 4, "title"), 5);
    expect(words()).toEqual(["2", "- Point 2", "Slide 3", "- Point 3", "Slide"]);
    expect(document.activeElement).toBe(region());
    expect(document.activeElement).not.toBe(title(2));
  });

  it("with the right button is not handed to the field: only a left press is followed", async () => {
    const { container } = await setup({ slides: 2 });
    const ghost = ghostOf(container, 2, "title");
    fireEvent.mouseDown(ghost, { button: 2 });
    selectBetween(ghost, 1, ghost, 4);
    fireEvent.mouseUp(document);
    expect(window.getSelection()?.toString()).toBe("lid");
  });

  it("does nothing more than once: a later release is a release like any other", async () => {
    const { container } = await setup({ slides: 2 });
    const ghost = ghostOf(container, 2, "title");
    drag(ghost, 1, ghost, 1);
    title(1).focus();
    fireEvent.mouseUp(document);
    expect(document.activeElement).toBe(title(1));
  });
});
