import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Filmstrip } from "./Filmstrip.tsx";
import { list, pickedOf, rows, setup, shownOf } from "./list-support.tsx";
import { idsOf, openDeck } from "./test-support.ts";

afterEach(cleanup);

describe("the list", () => {
  it("has a row for each slide, numbered, with the shown one marked", async () => {
    await setup({ slides: 4 });
    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual(["Slide 1", "Slide 2", "Slide 3", "Slide 4"]);
    expect(rows().map((row) => row.querySelector(".ks-fs-num")?.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(shownOf()).toBe(0);
    expect(pickedOf()).toEqual([0]);
    expect(list().getAttribute("aria-multiselectable")).toBe("true");
  });

  it("follows the session: the shown slide, and slides added and removed", async () => {
    const { session } = await setup({ slides: 3 });
    const [, b] = idsOf(session);
    act(() => session.goTo(b!));
    expect(shownOf()).toBe(1);
    act(() => void session.slides.add());
    expect(rows()).toHaveLength(4);
    expect(shownOf()).toBe(2);
    expect(list().getAttribute("aria-activedescendant")).toBe(rows()[2]!.id);
  });

  it("draws each slide small, in the deck's theme", async () => {
    const { container } = await setup({ slides: 2 });
    const thumbs = container.querySelectorAll(".ks-thumb .ks-slide");
    expect(thumbs).toHaveLength(2);
    const slide = thumbs[0] as HTMLElement;
    expect(slide.getAttribute("data-mode")).toBe("thumbnail");
    expect(slide.style.transform).toMatch(/^scale\(0\.1666/);
    expect(slide.style.transformOrigin).toMatch(/^0(px)? 0(px)?$/);
    expect((slide.parentElement as HTMLElement).style.width).toBe("160px");
    expect((slide.parentElement as HTMLElement).style.height).toBe("90px");
  });
});

describe("picking slides", () => {
  it("shows a slide on a click", async () => {
    const { session } = await setup({ slides: 4 });
    const ids = idsOf(session);
    fireEvent.click(rows()[2]!);
    expect(session.state.slideId).toBe(ids[2]);
    expect(session.state.slideSelection).toEqual([ids[2]]);
    expect(shownOf()).toBe(2);
    expect(pickedOf()).toEqual([2]);
  });

  it("adds and takes away slides with Ctrl or Cmd and a click", async () => {
    const { session } = await setup({ slides: 5 });
    const ids = idsOf(session);
    fireEvent.click(rows()[1]!);
    fireEvent.click(rows()[3]!, { ctrlKey: true });
    expect(session.state.slideSelection).toEqual([ids[1], ids[3]]);
    expect(session.state.slideId).toBe(ids[3]);
    expect(pickedOf()).toEqual([1, 3]);
    fireEvent.click(rows()[0]!, { metaKey: true });
    expect(session.state.slideSelection).toEqual([ids[0], ids[1], ids[3]]);
    fireEvent.click(rows()[0]!, { ctrlKey: true });
    fireEvent.click(rows()[3]!, { ctrlKey: true });
    expect(session.state.slideSelection).toEqual([ids[1]]);
    expect(session.state.slideId).toBe(ids[1]);
    // The last one stays.
    fireEvent.click(rows()[1]!, { ctrlKey: true });
    expect(session.state.slideSelection).toEqual([ids[1]]);
  });

  it("extends from the shown slide with Shift and a click, and keeps that slide shown", async () => {
    const { session } = await setup({ slides: 6 });
    const ids = idsOf(session);
    fireEvent.click(rows()[1]!);
    fireEvent.click(rows()[4]!, { shiftKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(1, 5));
    expect(session.state.slideId).toBe(ids[1]);
    expect(pickedOf()).toEqual([1, 2, 3, 4]);
    fireEvent.click(rows()[0]!, { shiftKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(0, 2));
    expect(session.state.slideId).toBe(ids[1]);
    // A plain click starts over.
    fireEvent.click(rows()[5]!);
    expect(session.state.slideSelection).toEqual([ids[5]]);
  });
});

describe("the keyboard", () => {
  it("moves the shown slide with the arrows, Home and End", async () => {
    const { session } = await setup({ slides: 4 });
    const ids = idsOf(session);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    expect(session.state.slideId).toBe(ids[1]);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowUp" });
    expect(session.state.slideId).toBe(ids[1]);
    fireEvent.keyDown(list(), { key: "End" });
    expect(session.state.slideId).toBe(ids[3]);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    expect(session.state.slideId).toBe(ids[3]);
    fireEvent.keyDown(list(), { key: "Home" });
    expect(session.state.slideId).toBe(ids[0]);
    expect(session.state.slideSelection).toEqual([ids[0]]);
  });

  it("grows and shrinks the selection with Shift and the arrows", async () => {
    const { session } = await setup({ slides: 5 });
    const ids = idsOf(session);
    fireEvent.click(rows()[1]!);
    fireEvent.keyDown(list(), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(list(), { key: "ArrowDown", shiftKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(1, 4));
    expect(session.state.slideId).toBe(ids[1]);
    fireEvent.keyDown(list(), { key: "ArrowUp", shiftKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(1, 3));
    fireEvent.keyDown(list(), { key: "End", shiftKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(1));
    fireEvent.keyDown(list(), { key: "Escape" });
    expect(session.state.slideSelection).toEqual([ids[1]]);
  });

  it("selects every slide with Ctrl+A, without touching the elements", async () => {
    const { session } = await setup({ slides: 3 });
    fireEvent.keyDown(list(), { key: "a", ctrlKey: true });
    expect(session.state.slideSelection).toEqual(idsOf(session));
    expect(session.state.selection).toEqual([]);
  });

  it("runs the commands bound to the filmstrip: delete, duplicate and move", async () => {
    const { session } = await setup({ slides: 4 });
    const [a, b, c, d] = idsOf(session) as [string, string, string, string];
    fireEvent.click(rows()[1]!);
    fireEvent.keyDown(list(), { key: "ArrowDown", ctrlKey: true, altKey: true });
    expect(idsOf(session)).toEqual([a, c, b, d]);
    fireEvent.keyDown(list(), { key: "ArrowUp", ctrlKey: true, altKey: true });
    expect(idsOf(session)).toEqual([a, b, c, d]);
    fireEvent.keyDown(list(), { key: "d", ctrlKey: true });
    expect(session.deck.slides).toHaveLength(5);
    expect(idsOf(session).slice(0, 2)).toEqual([a, b]);
    expect(session.state.slideSelection).toHaveLength(1);
    fireEvent.keyDown(list(), { key: "Delete" });
    expect(idsOf(session)).toEqual([a, b, c, d]);
    // Several at once.
    fireEvent.click(rows()[0]!);
    fireEvent.click(rows()[2]!, { shiftKey: true });
    fireEvent.keyDown(list(), { key: "Backspace" });
    expect(idsOf(session)).toEqual([d]);
  });

  it("runs the editor's own commands too, and leaves other keys alone", async () => {
    const { session } = await setup({ slides: 2 });
    // Ctrl+M is New slide, which works wherever the focus is.
    expect(fireEvent.keyDown(list(), { key: "m", ctrlKey: true })).toBe(false);
    expect(session.deck.slides).toHaveLength(3);
    // Ctrl+X cuts elements on the slide; here it is nobody's, and the browser may have it.
    expect(fireEvent.keyDown(list(), { key: "x", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(list(), { key: "q" })).toBe(true);
  });

  it("hands the focus to the slide on Tab", async () => {
    const made = await openDeck({ slides: 2 });
    render(
      <div className="ks-editor">
        <Filmstrip session={made.session} ui={made.ui} />
        <div className="ks-stage" tabIndex={0} />
      </div>,
    );
    list().focus();
    fireEvent.keyDown(list(), { key: "Tab" });
    expect(document.activeElement?.className).toBe("ks-stage");
  });

  it("adds a slide after the one shown on Enter, and shows it, with the focus staying in the list", async () => {
    const { session } = await setup({ slides: 3 });
    const ids = idsOf(session);
    fireEvent.click(rows()[0]!);
    list().focus();
    fireEvent.keyDown(list(), { key: "Enter" });
    expect(session.deck.slides).toHaveLength(4);
    expect(idsOf(session)[0]).toBe(ids[0]);
    expect(idsOf(session)[2]).toBe(ids[1]);
    expect(session.state.slideId).toBe(idsOf(session)[1]);
    expect(document.activeElement).toBe(list());
  });

  it("opens the slide menu from the keyboard", async () => {
    const { ui } = await setup({ slides: 2 });
    fireEvent.keyDown(list(), { key: "ContextMenu" });
    expect(ui.state.contextMenu?.kind).toBe("slide");
  });
});

describe("the mouse menu", () => {
  it("opens the slide menu where the pointer is, after picking the slide if it was not picked", async () => {
    const { session, ui } = await setup({ slides: 4 });
    const ids = idsOf(session);
    fireEvent.contextMenu(rows()[2]!, { clientX: 44, clientY: 91 });
    expect(ui.state.contextMenu).toEqual({ kind: "slide", x: 44, y: 91 });
    expect(session.state.slideSelection).toEqual([ids[2]]);
    expect(session.state.slideId).toBe(ids[2]);
  });

  it("keeps a selection the slide is part of", async () => {
    const { session, ui } = await setup({ slides: 4 });
    const ids = idsOf(session);
    fireEvent.click(rows()[0]!);
    fireEvent.click(rows()[2]!, { shiftKey: true });
    fireEvent.contextMenu(rows()[1]!, { clientX: 5, clientY: 6 });
    expect(session.state.slideSelection).toEqual(ids.slice(0, 3));
    expect(ui.state.contextMenu).toMatchObject({ kind: "slide" });
  });
});

describe("adding", () => {
  it("adds a slide with the button, after the shown one", async () => {
    const { session } = await setup({ slides: 3 });
    const ids = idsOf(session);
    fireEvent.click(rows()[1]!);
    fireEvent.click(screen.getByRole("button", { name: "New slide" }));
    expect(session.deck.slides).toHaveLength(4);
    expect(idsOf(session).slice(0, 2)).toEqual([ids[0], ids[1]]);
    expect(session.state.slideId).toBe(idsOf(session)[2]);
  });

  it("adds a slide on a double click in the empty space, and not on a slide", async () => {
    const { session, container } = await setup({ slides: 2 });
    fireEvent.doubleClick(rows()[0]!);
    expect(session.deck.slides).toHaveLength(2);
    fireEvent.doubleClick(container.querySelector(".ks-filmstrip") as HTMLElement);
    expect(session.deck.slides).toHaveLength(3);
    fireEvent.doubleClick(list());
    expect(session.deck.slides).toHaveLength(4);
  });
});

describe("flags", () => {
  it("dims a slide that is skipped and marks it with an eye", async () => {
    await setup({ slides: 3, hidden: [1] });
    expect(rows()[1]!.classList.contains("is-skipped")).toBe(true);
    expect(rows()[1]!.querySelector('[title="Skipped when presenting"]')).not.toBeNull();
    expect(rows()[1]!.getAttribute("aria-label")).toBe("Slide 2, skipped when presenting");
    expect(rows()[0]!.classList.contains("is-skipped")).toBe(false);
    expect(rows()[0]!.querySelector('[title="Skipped when presenting"]')).toBeNull();
  });

  it("draws a backup slide further in, as a pile, with a tag", async () => {
    await setup({ slides: 3, backup: [2] });
    const backup = rows()[2]!;
    expect(backup.classList.contains("is-backup")).toBe(true);
    expect(backup.querySelector(".ks-fs-stack")).not.toBeNull();
    expect(backup.textContent).toContain("Backup");
    expect(backup.getAttribute("aria-label")).toBe("Slide 3, backup");
    expect(rows()[1]!.querySelector(".ks-fs-stack")).toBeNull();
    expect(rows()[1]!.textContent).not.toContain("Backup");
    // Smaller, so that it fits with the offset edge.
    expect((backup.querySelector(".ks-thumb") as HTMLElement).style.width).toBe("146px");
  });
});
