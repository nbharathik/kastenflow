import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { list, rows, setup, shownOf } from "./list-support.tsx";
import { idsOf } from "./test-support.ts";

afterEach(cleanup);

describe("sections", () => {
  const sections = [
    { title: "Intro", at: 0 },
    { title: "Part two", at: 3 },
  ];

  it("puts a header above the slide a section starts at", async () => {
    await setup({ slides: 6, sections });
    const kids = [...list().children].map((el) => (el.classList.contains("ks-fs-section") ? `#${el.textContent}` : el.getAttribute("aria-label")));
    expect(kids).toEqual(["#Intro", "Slide 1", "Slide 2", "Slide 3", "#Part two", "Slide 4", "Slide 5", "Slide 6"]);
  });

  it("folds a section away and opens it again", async () => {
    const { session } = await setup({ slides: 6, sections });
    fireEvent.click(screen.getByRole("button", { name: "Collapse section Part two" }));
    expect(rows()).toHaveLength(3);
    // The header stays and says how many slides are in it.
    const fold = screen.getByRole("button", { name: "Expand section Part two" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.closest(".ks-fs-section")?.textContent).toBe("Part two3");
    // The deck itself is untouched.
    expect(session.deck.slides).toHaveLength(6);
    fireEvent.click(fold);
    expect(rows()).toHaveLength(6);
  });

  it("steps over folded slides with the arrow keys", async () => {
    const { session } = await setup({ slides: 6, sections });
    const ids = idsOf(session);
    fireEvent.click(screen.getByRole("button", { name: "Collapse section Part two" }));
    fireEvent.click(rows()[2]!);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    expect(session.state.slideId).toBe(ids[2]);
    fireEvent.keyDown(list(), { key: "End" });
    expect(session.state.slideId).toBe(ids[2]);
    // Selecting everything takes only what can be seen.
    fireEvent.keyDown(list(), { key: "a", ctrlKey: true });
    expect(session.state.slideSelection).toEqual(ids.slice(0, 3));
  });

  it("opens the section of a slide that is shown from somewhere else", async () => {
    const { session } = await setup({ slides: 6, sections });
    fireEvent.click(screen.getByRole("button", { name: "Collapse section Part two" }));
    expect(rows()).toHaveLength(3);
    act(() => session.goTo(idsOf(session)[4]!));
    expect(rows()).toHaveLength(6);
    expect(shownOf()).toBe(4);
  });

  it("does not open the section the person has just folded, though the shown slide is in it", async () => {
    const { session } = await setup({ slides: 6, sections });
    fireEvent.click(rows()[4]!);
    fireEvent.click(screen.getByRole("button", { name: "Collapse section Part two" }));
    expect(rows()).toHaveLength(3);
    expect(session.state.slideId).toBe(idsOf(session)[4]);
  });

  it("folds and opens with the Left and Right keys", async () => {
    await setup({ slides: 6, sections });
    fireEvent.click(rows()[4]!);
    fireEvent.keyDown(list(), { key: "ArrowLeft" });
    expect(rows()).toHaveLength(3);
    fireEvent.keyDown(list(), { key: "ArrowRight" });
    expect(rows()).toHaveLength(6);
  });

});
