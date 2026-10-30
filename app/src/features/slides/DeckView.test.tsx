import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SlidesEditorProps } from "@kasten-slides/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaneContext } from "../workspace/pane-context";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { focusPane, initialLayout, split } from "../workspace/tabs";
import { DeckView } from "./DeckView";
import { deckUi, keepDeckUi, resetDeckUi, wantAssistant } from "./deck-ui";

const seen = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@kasten-slides/react", async (original) => ({
  ...(await original<typeof import("@kasten-slides/react")>()),
  SlidesEditor: (props: SlidesEditorProps) => {
    seen.push(props as unknown as Record<string, unknown>);
    return <div data-testid="editor" />;
  },
}));

// The assistant tab is the chat's, and none of what is tested here.
vi.mock("./AiTab", () => ({ AiTab: () => null }));

const DECK = "decks/talk.deck";
const last = () => seen.at(-1)!;

beforeEach(() => {
  seen.length = 0;
  const base = split(initialLayout({ view: "slides", path: DECK }), { view: "page", path: "a.md" });
  useWorkspace.setState({ ...derive(focusPane(base, base.panes[0]!.id)), notes: [], toasts: [], client: { deck: () => Promise.resolve({ path: DECK, text: "{}", hash: "h" }) } as never });
});

afterEach(() => {
  cleanup();
  resetDeckUi();
});

describe("the deck's window state", () => {
  const left = () => useWorkspace.getState().layout.panes[0]!.id;
  const shown = () => (
    <PaneContext.Provider value={left()}>
      <DeckView path={DECK} />
    </PaneContext.Provider>
  );
  const snapshot = { panel: "ai", view: "edit", slideId: "s3", slideSelection: ["s3"], selection: ["e1"], filmstripOpen: true, filmstripWidth: 260, filmstripScroll: 120 };

  it("opens a deck never seen on its usual state", async () => {
    render(shown());
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(last().initialUi).toBeUndefined();
  });

  it("keeps the state the editor reports, and gives it back when the tab's view is built again", async () => {
    const first = render(shown());
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    act(() => (last().onUiChange as (s: unknown) => void)(snapshot));
    expect(deckUi(DECK)).toEqual(snapshot);
    // The tab's view was put away (keep-alive limit) and is built again.
    first.unmount();
    render(shown());
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(last().initialUi).toEqual(snapshot);
  });

  it("keeps each deck's state apart", async () => {
    keepDeckUi("decks/other.deck", { ...snapshot, slideId: "s9" } as never);
    render(shown());
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(last().initialUi).toBeUndefined();
  });

  it("opens the assistant panel in the editor that is shown, when something asks for it", async () => {
    render(shown());
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    const openPanel = vi.fn();
    act(() => (last().onSession as (s: unknown, u: unknown) => void)({}, { openPanel }));
    wantAssistant(DECK);
    expect(openPanel).toHaveBeenCalledWith("ai");
  });
});

describe("the deck in a tab", () => {
  it("gives the editor the keys when its pane is in use, and says which deck keys on the bare page go to", async () => {
    const left = useWorkspace.getState().layout.panes[0]!.id;
    render(
      <PaneContext.Provider value={left}>
        <DeckView path={DECK} />
      </PaneContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(last()).toMatchObject({ autoFocus: true, focusKey: 1 });
    expect((last().routeOrphanKeys as () => boolean)()).toBe(true);
  });

  it("does not take the keys while another pane is in use, and takes them again when its pane is", async () => {
    const [left, right] = useWorkspace.getState().layout.panes.map((p) => p.id) as [string, string];
    render(
      <PaneContext.Provider value={left}>
        <DeckView path={DECK} />
      </PaneContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    act(() => useWorkspace.setState(derive(focusPane(useWorkspace.getState().layout, right))));
    expect(last()).toMatchObject({ autoFocus: false, focusKey: false });
    expect((last().routeOrphanKeys as () => boolean)()).toBe(false);
    act(() => useWorkspace.setState(derive(focusPane(useWorkspace.getState().layout, left))));
    expect(last()).toMatchObject({ autoFocus: true, focusKey: 2 });
  });
});
