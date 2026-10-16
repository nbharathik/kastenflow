import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { coverWindow } from "../browser/cover";
import { PaneContext } from "../workspace/pane-context";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { focusPane, initialLayout, selectTab, openTab, split, type Layout } from "../workspace/tabs";
import { useDeckFocus } from "./deck-focus";

const DECK = "decks/talk.deck";

/** A deck on the left, a page on the right; the left pane is in use. */
function twoPanes(): Layout {
  const base = split(initialLayout({ view: "slides", path: DECK }), { view: "page", path: "a.md" });
  return focusPane(base, base.panes[0]!.id);
}

const show = (layout: Layout) => act(() => useWorkspace.setState(derive(layout)));
const inPane = (id: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <PaneContext.Provider value={id}>{children}</PaneContext.Provider>;
  };

beforeEach(() => {
  show(twoPanes());
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("a deck in the pane that is in use", () => {
  it("takes the keys as it is shown and is the deck keys that fall on the page go to", () => {
    const left = useWorkspace.getState().layout.panes[0]!.id;
    const { result } = renderHook(() => useDeckFocus(DECK), { wrapper: inPane(left) });
    expect(result.current.autoFocus).toBe(true);
    expect(result.current.focusKey).toBe(1);
    expect(result.current.routeOrphanKeys()).toBe(true);
  });

  it("takes the keys again each time its pane comes back into use, and not while it is out of use", () => {
    const { panes } = useWorkspace.getState().layout;
    const { result } = renderHook(() => useDeckFocus(DECK), { wrapper: inPane(panes[0]!.id) });
    expect(result.current.focusKey).toBe(1);
    show(focusPane(useWorkspace.getState().layout, panes[1]!.id));
    expect(result.current).toMatchObject({ autoFocus: false, focusKey: false });
    expect(result.current.routeOrphanKeys()).toBe(false);
    show(focusPane(useWorkspace.getState().layout, panes[0]!.id));
    expect(result.current).toMatchObject({ autoFocus: true, focusKey: 2 });
    expect(result.current.routeOrphanKeys()).toBe(true);
    // The same pane focused again is not a new turn.
    show(focusPane(useWorkspace.getState().layout, panes[0]!.id));
    expect(result.current.focusKey).toBe(2);
  });
});

describe("a deck in a pane that is not in use", () => {
  it("does not take the keys, and keys that fall on the page do not go to it", () => {
    const right = useWorkspace.getState().layout.panes[1]!.id;
    const { result } = renderHook(() => useDeckFocus(DECK), { wrapper: inPane(right) });
    expect(result.current.autoFocus).toBe(false);
    expect(result.current.focusKey).toBe(false);
    expect(result.current.routeOrphanKeys()).toBe(false);
  });
});

describe("keys that fall on the bare page", () => {
  const route = () => {
    const left = useWorkspace.getState().layout.panes[0]!.id;
    return renderHook(() => useDeckFocus(DECK), { wrapper: inPane(left) }).result;
  };

  it("go only to the deck in front of its pane: another tab or another deck in front is not it", () => {
    const result = route();
    const left = useWorkspace.getState().layout.panes[0]!;
    const deckTab = left.tabs[0]!;
    // Another tab comes to the front of the pane.
    show(openTab(useWorkspace.getState().layout, { view: "page", path: "b.md" }));
    expect(result.current.routeOrphanKeys()).toBe(false);
    show(selectTab(useWorkspace.getState().layout, left.id, deckTab.id));
    expect(result.current.routeOrphanKeys()).toBe(true);
    // Another deck in front.
    show(openTab(useWorkspace.getState().layout, { view: "slides", path: "decks/other.deck" }));
    expect(result.current.routeOrphanKeys()).toBe(false);
  });

  it("stay with a dialog or the palette while one is open", () => {
    const result = route();
    expect(result.current.routeOrphanKeys()).toBe(true);
    render(<div role="dialog" aria-modal="true" aria-label="Palette" />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(result.current.routeOrphanKeys()).toBe(false);
    cleanup();
    expect(result.current.routeOrphanKeys()).toBe(true);
  });

  it("stay with a presentation that fills the window", () => {
    const result = route();
    const uncover = coverWindow();
    expect(result.current.routeOrphanKeys()).toBe(false);
    uncover();
    expect(result.current.routeOrphanKeys()).toBe(true);
  });

  it("are asked about the pane as it is now, not as it was when the deck was shown", () => {
    const result = route();
    const routed = result.current.routeOrphanKeys;
    expect(routed()).toBe(true);
    const { panes } = useWorkspace.getState().layout;
    show(focusPane(useWorkspace.getState().layout, panes[1]!.id));
    // The very function the editor was given earlier answers for the pane as it is now.
    expect(routed()).toBe(false);
  });
});
