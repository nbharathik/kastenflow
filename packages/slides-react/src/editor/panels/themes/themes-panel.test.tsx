import { builtInThemes } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { edit, mount } from "../format/test-kit.tsx";

afterEach(cleanup);

const themes = () => within(screen.getByRole("listbox", { name: "Themes" }));
const layouts = () => within(screen.getByRole("listbox", { name: "Layouts" }));
/** The name a card is called, not the words of the slide drawn on it. */
const nameOf = (card: HTMLElement) => card.querySelector(".ks-th-name")?.textContent;

describe("the themes panel", () => {
  it("shows every built-in theme as a card with a small drawing of its title slide, the deck's own checked", async () => {
    const kit = await mount({ panel: "themes" });
    const names = builtInThemes();
    expect(themes().getAllByRole("option").map(nameOf)).toEqual(names);
    expect(themes().getByRole("option", { name: kit.session.deck.theme.name }).getAttribute("aria-selected")).toBe("true");
    expect(themes().getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    // The names are there at once; each card draws its slide a moment later (the card for the deck's own theme too).
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Themes" }).querySelectorAll(".ks-slide").length).toBeGreaterThanOrEqual(names.length));
  });

  it("restyles the deck with the theme picked, as one step, keeping the slides' words", async () => {
    const kit = await mount({ panel: "themes" });
    const slides = kit.session.deck.slides.length;
    const revision = kit.session.state.revision;
    fireEvent.click(themes().getByRole("option", { name: "Serif" }));
    expect(kit.session.deck.theme.name).toBe("Serif");
    expect(kit.session.deck.slides).toHaveLength(slides);
    expect(kit.session.state.revision).toBe(revision + 1);
    expect(themes().getByRole("option", { name: "Serif" }).getAttribute("aria-selected")).toBe("true");
    expect(kit.errors).toEqual([]);
    // Picking the one in use changes nothing.
    fireEvent.click(themes().getByRole("option", { name: "Serif" }));
    expect(kit.session.state.revision).toBe(revision + 1);
  });

  it("moves over the cards with the arrow keys, two to a row, as the other lists of the panel do", async () => {
    await mount({ panel: "themes" });
    const cards = themes().getAllByRole("option");
    const first = cards.find((c) => c.tabIndex === 0)!;
    first.focus();
    const at = cards.indexOf(first);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cards[at + 1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cards[at + 3]);
  });

  it("lists the layouts of the deck's theme, the one the slide is on checked, and puts the slide on the one picked", async () => {
    const kit = await mount({ panel: "themes" });
    const all = kit.session.deck.theme.layouts;
    expect(layouts().getAllByRole("option").map(nameOf)).toEqual(all.map((l) => l.label));
    expect(layouts().getByRole("option", { name: "Blank" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(layouts().getByRole("option", { name: "Two columns" }));
    expect(kit.session.slide.layout).toBe("two-columns");
    expect(layouts().getByRole("option", { name: "Two columns" }).getAttribute("aria-selected")).toBe("true");
    edit(() => kit.session.undo());
    expect(kit.session.slide.layout).toBe("blank");
  });

  it("opens the dialog for the colours, fonts and logo", async () => {
    const kit = await mount({ panel: "themes" });
    fireEvent.click(screen.getByRole("button", { name: "Colours, fonts and logo…" }));
    expect(kit.ui.state.dialog).toBe("theme");
  });

  it("folds its two sections, and keeps them folded the next time", async () => {
    const kit = await mount({ panel: "themes" });
    fireEvent.click(screen.getByRole("button", { name: "Layouts" }));
    expect(screen.queryByRole("listbox", { name: "Layouts" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "Themes" })).toBeTruthy();
    expect(kit.ui.state.panel).toBe("themes");
    expect(JSON.parse(localStorage.getItem("ks-chrome-folds") ?? "{}")).toEqual({ layouts: true });
  });
});
