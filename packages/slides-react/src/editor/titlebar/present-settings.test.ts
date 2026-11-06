import type { CustomShow, Deck } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import type { EditorSession } from "../session/session.ts";
import { INTERVALS, intervalName, intervalOf, isLooping, nextShowId, nextShowName, problemWith, setAutoAdvance, setLoop, setShows, showsOf } from "./present-settings.ts";

const show = (id: string, name: string, slides: string[] = ["s-1"]): CustomShow => ({ id, name, slides });
const deckWith = (present: Record<string, unknown>): Deck => ({ present }) as unknown as Deck;

/** A session that records the operations it is asked to run. */
function fake(deck: Deck) {
  const apply = vi.fn();
  const session = { deck, run: (call: () => unknown) => call(), core: { apply } } as unknown as EditorSession;
  return { session, apply };
}

describe("what the deck says about how it is shown", () => {
  it("reads the loop, the wait and the shows, which a deck that never set them does not have", () => {
    expect([isLooping(deckWith({})), intervalOf(deckWith({})), showsOf(deckWith({}))]).toEqual([false, 0, []]);
    expect([isLooping(deckWith({ loop: true })), intervalOf(deckWith({ autoAdvance: 5 }))]).toEqual([true, 5]);
  });

  it("names the waits the menu offers", () => {
    expect(INTERVALS[0]).toBe(0);
    expect(INTERVALS.map(intervalName)).toEqual(["Off", "3 seconds", "5 seconds", "10 seconds", "15 seconds", "30 seconds", "1 minute"]);
    expect(intervalName(120)).toBe("2 minutes");
  });
});

describe("changing it", () => {
  it("sets the loop and the wait through the deck's own operation, and not when they would not change", () => {
    const { session, apply } = fake(deckWith({}));
    setLoop(session, true);
    setAutoAdvance(session, 10);
    expect(apply).toHaveBeenNthCalledWith(1, "set_present", { loop: true });
    expect(apply).toHaveBeenNthCalledWith(2, "set_present", { autoAdvance: 10 });
    const same = fake(deckWith({ loop: true, autoAdvance: 10 }));
    setLoop(same.session, true);
    setAutoAdvance(same.session, 10);
    expect(same.apply).not.toHaveBeenCalled();
  });

  it("replaces the shows as a list", () => {
    const { session, apply } = fake(deckWith({}));
    setShows(session, [show("show-1", "Short")]);
    expect(apply).toHaveBeenCalledWith("set_present", { shows: [{ id: "show-1", name: "Short", slides: ["s-1"] }] });
  });
});

describe("making and checking a show", () => {
  it("gives a new show an id and a name no other has", () => {
    const shows = [show("show-1", "Custom show 1"), show("show-3", "Custom show 2")];
    expect(nextShowId(shows)).toBe("show-2");
    expect(nextShowName(shows)).toBe("Custom show 3");
    expect(nextShowId([])).toBe("show-1");
  });

  it("says why a show cannot be kept, as the deck would", () => {
    const shows = [show("a", "Short"), show("b", "Long")];
    expect(problemWith(show("c", "  "), shows)).toBe("Give the show a name.");
    expect(problemWith(show("c", "short"), shows)).toBe("Another show has that name.");
    expect(problemWith(show("c", "New", []), shows)).toBe("Pick at least one slide.");
    expect(problemWith(show("c", "x".repeat(81)), shows)).toMatch(/at most 80/);
    expect(problemWith(show("a", "Short"), shows)).toBeNull();
  });
});
