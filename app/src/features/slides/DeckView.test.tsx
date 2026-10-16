import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SlidesEditorProps } from "@kasten-slides/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaneContext } from "../workspace/pane-context";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { focusPane, initialLayout, split } from "../workspace/tabs";
import { DeckView } from "./DeckView";

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

afterEach(cleanup);

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
