// A linked board, deck or diagram shown in a page says "Updated" when its file
// changed after the page showed it: the vault's counter for its kind moved and
// the item's own time moved with it. Clicking the badge puts it away until the
// next change.

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBoards } from "../boards/store";
import { useDiagrams } from "../diagrams/store";
import { useDecks } from "../slides/store";
import { applyRevision, resetRevision, useRevision } from "../workspace/revision";
import { UpdatedBadge } from "./UpdatedBadge";
import { useUpdated } from "./use-updated";

const REVISION = { epoch: 1, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };
/** The core counts a change: the counter of its kind and the total move. */
let counted = 0;
const bump = (area: "boards" | "decks") => {
  counted += 1;
  const { revision } = useRevision.getState();
  applyRevision({ ...revision, all: counted, [area]: revision[area] + 1 });
};

beforeEach(() => {
  counted = 0;
  resetRevision();
  applyRevision(REVISION);
  useBoards.setState({ list: [] });
  useDecks.setState({ list: [] });
  useDiagrams.setState({ list: [] });
});
afterEach(cleanup);

describe("useUpdated", () => {
  it("is false until the counter moves and the item's own time moves with it", () => {
    const { result, rerender } = renderHook(({ modified }) => useUpdated("decks", modified), { initialProps: { modified: 10 as number | undefined } });
    expect(result.current.updated).toBe(false);
    // The counter moved for some other deck: this one's time did not.
    act(() => bump("decks"));
    expect(result.current.updated).toBe(false);
    rerender({ modified: 20 });
    expect(result.current.updated).toBe(true);
  });

  it("waits for the item to be known, and does not call the first reading a change", () => {
    const { result, rerender } = renderHook(({ modified }) => useUpdated("boards", modified), { initialProps: { modified: undefined as number | undefined } });
    expect(result.current.updated).toBe(false);
    rerender({ modified: 5 });
    act(() => bump("boards"));
    expect(result.current.updated).toBe(false);
  });

  it("is put away by dismiss, and comes back with the next change", () => {
    const { result, rerender } = renderHook(({ modified }) => useUpdated("decks", modified), { initialProps: { modified: 10 } });
    act(() => bump("decks"));
    rerender({ modified: 20 });
    expect(result.current.updated).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.updated).toBe(false);
    act(() => bump("decks"));
    rerender({ modified: 30 });
    expect(result.current.updated).toBe(true);
  });

  it("ignores another kind's counter", () => {
    const { result, rerender } = renderHook(({ modified }) => useUpdated("decks", modified), { initialProps: { modified: 10 } });
    act(() => bump("boards"));
    rerender({ modified: 20 });
    expect(result.current.updated).toBe(false);
  });
});

const deck = (modified: number) => ({ path: "talks/pitch.deck", title: "Pitch", project: null, slides: 3, modified, size: 1, problem: null });
const board = (modified: number) => ({ path: "boards/map.canvas", title: "Map", project: null, nodes: 2, modified });
const diagram = (modified: number) => ({ path: "library/flow.drawio", title: "Flow", project: null, pages: 1, modified, size: 1, preview: "fresh" as const, problem: null });

describe("the badge", () => {
  it("shows on a deck that changed after the page showed it, and goes when it is clicked", () => {
    useDecks.setState({ list: [deck(1)] });
    render(<UpdatedBadge kind="deck" path="talks/pitch.deck" />);
    expect(screen.queryByRole("button", { name: /Updated/ })).toBeNull();
    act(() => {
      useDecks.setState({ list: [deck(2)] });
      bump("decks");
    });
    const badge = screen.getByRole("button", { name: "Pitch was updated. Dismiss" });
    expect(badge.textContent).toBe("Updated");
    expect(badge.title).toContain("changed since you opened this page");
    fireEvent.click(badge);
    expect(screen.queryByRole("button", { name: /Updated/ })).toBeNull();
  });

  it("works for a board and for a diagram, each by its own kind's counter", () => {
    useBoards.setState({ list: [board(1)] });
    useDiagrams.setState({ list: [diagram(1)] });
    render(
      <>
        <UpdatedBadge kind="board" path="boards/map.canvas" />
        <UpdatedBadge kind="diagram" path="library/flow.drawio" />
      </>,
    );
    act(() => {
      useBoards.setState({ list: [board(2)] });
      bump("boards");
    });
    expect(screen.getByRole("button", { name: "Map was updated. Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Flow was updated. Dismiss" })).toBeNull();
    // Diagrams count with decks.
    act(() => {
      useDiagrams.setState({ list: [diagram(2)] });
      bump("decks");
    });
    expect(screen.getByRole("button", { name: "Flow was updated. Dismiss" })).toBeTruthy();
  });

  it("says nothing for an item that is not in the list", () => {
    render(<UpdatedBadge kind="deck" path="talks/gone.deck" />);
    act(() => bump("decks"));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
