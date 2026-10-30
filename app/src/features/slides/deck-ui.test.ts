import type { UiSnapshot } from "@kasten-slides/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deckUi, forgetDeckUi, keepDeckUi, resetDeckUi, setLiveDeck, wantAssistant } from "./deck-ui";

const snap = (over: Partial<UiSnapshot> = {}): UiSnapshot => ({ panel: null, view: "edit", slideId: "s1", slideSelection: ["s1"], selection: [], filmstripOpen: true, filmstripWidth: null, filmstripScroll: 0, ...over });

afterEach(resetDeckUi);

describe("how each deck's window was left", () => {
  it("keeps the latest state for each deck, apart from the others", () => {
    keepDeckUi("a.deck", snap({ panel: "ai", slideId: "s3" }));
    keepDeckUi("b.deck", snap());
    keepDeckUi("a.deck", snap({ panel: "ai", slideId: "s4", filmstripWidth: 260 }));
    expect(deckUi("a.deck")).toMatchObject({ slideId: "s4", filmstripWidth: 260 });
    expect(deckUi("b.deck")?.panel).toBeNull();
    expect(deckUi("c.deck")).toBeUndefined();
    forgetDeckUi("a.deck");
    expect(deckUi("a.deck")).toBeUndefined();
  });

  it("forgets the decks used longest ago past forty", () => {
    for (let n = 0; n < 45; n++) keepDeckUi(`d${n}.deck`, snap());
    expect(deckUi("d0.deck")).toBeUndefined();
    expect(deckUi("d4.deck")).toBeUndefined();
    expect(deckUi("d5.deck")).toBeDefined();
    expect(deckUi("d44.deck")).toBeDefined();
  });

  it("opens the assistant panel of a deck whose tab is shown now, or the next time it is", () => {
    const openPanel = vi.fn();
    setLiveDeck("a.deck", { openPanel });
    wantAssistant("a.deck");
    expect(openPanel).toHaveBeenCalledWith("ai");
    setLiveDeck("a.deck", null);
    keepDeckUi("a.deck", snap({ slideId: "s2" }));
    wantAssistant("a.deck");
    expect(deckUi("a.deck")).toMatchObject({ panel: "ai", slideId: "s2" });
    wantAssistant("new.deck");
    expect(deckUi("new.deck")?.panel).toBe("ai");
  });
});
