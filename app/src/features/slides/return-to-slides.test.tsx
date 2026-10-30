// Coming back to Slides: "Go to Slides" and the sidebar's Slides bring an open deck forward instead of replacing it, and the Slides home
// offers to continue it.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChat } from "../chat/store";
import { resetChat, scriptedChat } from "../chat/test-kit";
import { newThread } from "../chat/thread";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout, openTab, split, type Layout } from "../workspace/tabs";
import { ContinueRow } from "./ContinueRow";
import { continueDeck, deckTabs, deckToContinue, goToSlides } from "./return-to-slides";
import { useDecks } from "./store";

const A = "decks/a.deck";
const B = "decks/b.deck";
const show = (layout: Layout) => useWorkspace.setState(derive(layout));
const state = () => useWorkspace.getState();
const tabsOf = (n = 0) => state().layout.panes[n]!.tabs.map((t) => t.place.path ?? t.place.view);

beforeEach(() => {
  resetChat(scriptedChat());
  useDecks.setState({ list: [{ path: A, title: "Talk A", slides: 3, problem: null } as never, { path: B, title: "Talk B", slides: 1, problem: null } as never], loaded: true });
  useWorkspace.setState({ recent: [], notes: [], toasts: [] });
});
afterEach(cleanup);

describe("Go to Slides", () => {
  it("brings the open deck's tab forward, and does not turn any tab into the Slides home", () => {
    show(openTab(openTab(initialLayout({ view: "page", path: "a.md" }), { view: "slides", path: A }), { view: "page", path: "b.md" }));
    expect(state().place.path).toBe("b.md");
    goToSlides();
    expect(state().place).toEqual({ view: "slides", path: A });
    expect(tabsOf()).toEqual(["a.md", A, "b.md"]);
  });

  it("finds a deck open in the other pane and focuses that pane", () => {
    const two = split(initialLayout({ view: "slides", path: A }), { view: "page", path: "a.md" });
    show(two);
    expect(state().layout.focus).toBe(two.panes[1]!.id);
    goToSlides();
    expect(state().layout.focus).toBe(two.panes[0]!.id);
    expect(state().place.path).toBe(A);
  });

  it("opens the Slides home when no deck is open", () => {
    show(initialLayout({ view: "page", path: "a.md" }));
    goToSlides();
    expect(state().place).toEqual({ view: "slides" });
  });

  it("opens the home in a tab of its own from inside a deck, leaving the deck's tab alone", () => {
    show(initialLayout({ view: "slides", path: A }));
    goToSlides();
    expect(state().place).toEqual({ view: "slides" });
    expect(tabsOf()).toEqual([A, "slides"]);
  });

  it("goes where a click with a key asks, deck open or not", () => {
    show(openTab(initialLayout({ view: "page", path: "a.md" }), { view: "slides", path: A }));
    act(() => state().selectTab(state().layout.panes[0]!.id, state().layout.panes[0]!.tabs[0]!.id));
    goToSlides("tab");
    expect(state().place).toEqual({ view: "slides" });
  });

  it("puts the shown deck first among the open ones", () => {
    show(openTab(openTab(initialLayout({ view: "page", path: "a.md" }), { view: "slides", path: A }), { view: "slides", path: B }));
    expect(deckTabs(state().layout).map((t) => t.path)).toEqual([B, A]);
  });
});

describe("Continue", () => {
  it("offers the deck that is open in a tab, else the one opened last that is still in the vault", () => {
    show(initialLayout({ view: "page", path: "a.md" }));
    expect(deckToContinue()).toBeNull();
    useWorkspace.setState({ recent: ["gone.deck", B, A] });
    expect(deckToContinue()).toEqual({ path: B, open: false });
    show(openTab(state().layout, { view: "slides", path: A }));
    expect(deckToContinue()).toEqual({ path: A, open: true });
  });

  it("focuses the open tab, or opens the deck", () => {
    show(openTab(initialLayout({ view: "page", path: "a.md" }), { view: "slides", path: A }));
    act(() => state().selectTab(state().layout.panes[0]!.id, state().layout.panes[0]!.tabs[0]!.id));
    continueDeck(A);
    expect(state().place.path).toBe(A);
    continueDeck(B);
    expect(state().place).toEqual({ view: "slides", path: B });
  });

  it("is a row on the Slides home named for the deck, and goes back to it in one click", () => {
    show(openTab(initialLayout({ view: "slides" }), { view: "slides", path: A }));
    act(() => state().selectTab(state().layout.panes[0]!.id, state().layout.panes[0]!.tabs[0]!.id));
    render(<ContinueRow />);
    const row = screen.getByRole("button", { name: "Continue: Talk A" });
    expect(row.textContent).toContain("Open in a tab");
    fireEvent.click(row);
    expect(state().place).toEqual({ view: "slides", path: A });
  });

  it("is not there with nothing to continue", () => {
    show(initialLayout({ view: "slides" }));
    render(<ContinueRow />);
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
  });

  it("says when the assistant works on the deck", () => {
    show(openTab(initialLayout({ view: "slides" }), { view: "slides", path: A }));
    render(<ContinueRow />);
    const row = () => screen.getByRole("button", { name: "Continue: Talk A" });
    expect(row().textContent).not.toContain("assistant");
    act(() => useChat.setState({ threads: { w: { ...newThread({ id: "w" }), streaming: true, bound: { kind: "deck", path: A } } } }));
    expect(row().textContent).toContain("The assistant is working on it");
  });
});
