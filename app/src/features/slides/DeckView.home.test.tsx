// The Home button of a deck's editor goes to the Slides home through the app, and the deck stays open in its tab.

import type { SlidesEditorProps } from "@kasten-slides/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaneContext } from "../workspace/pane-context";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { DeckView } from "./DeckView";
import { resetDeckUi } from "./deck-ui";

const seen = vi.hoisted(() => [] as SlidesEditorProps[]);

vi.mock("@kasten-slides/react", async (original) => ({
  ...(await original<typeof import("@kasten-slides/react")>()),
  SlidesEditor: (props: SlidesEditorProps) => {
    seen.push(props);
    return <div data-testid="editor" />;
  },
}));
vi.mock("./AiTab", () => ({ AiTab: () => null }));

const DECK = "decks/talk.deck";
const state = () => useWorkspace.getState();
const tabs = () => state().layout.panes[0]!.tabs.map((t) => t.place.path ?? t.place.view);

beforeEach(() => {
  seen.length = 0;
  const layout = initialLayout({ view: "slides", path: DECK });
  useWorkspace.setState({ ...derive(layout), notes: [], toasts: [], client: { deck: () => Promise.resolve({ path: DECK, text: "{}", hash: "h" }) } as never });
});
afterEach(() => {
  cleanup();
  resetDeckUi();
});

describe("Home in a deck", () => {
  it("is given to the editor, and opens the Slides home in a tab of its own, leaving the deck open", async () => {
    render(
      <PaneContext.Provider value={state().layout.panes[0]!.id}>
        <DeckView path={DECK} />
      </PaneContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    const home = seen.at(-1)!.actions?.home;
    expect(home).toBeTypeOf("function");
    home!();
    expect(state().place).toEqual({ view: "slides" });
    expect(tabs()).toEqual([DECK, "slides"]);
    // From the home again: the one home tab is shown, not a second.
    state().selectTab(state().layout.panes[0]!.id, state().layout.panes[0]!.tabs[0]!.id);
    home!();
    expect(tabs()).toEqual([DECK, "slides"]);
    expect(state().place).toEqual({ view: "slides" });
  });
});
