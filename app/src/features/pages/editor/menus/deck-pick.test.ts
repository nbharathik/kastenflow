// "/deck": pick a deck to show in the page, narrowing by typing, or make a
// new one; the embed lands on a line of its own and the file stays a link.

import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { DeckLink, LinkProvider } from "../links";
import { matchChoices, SLASH_CHOICES } from "./catalog";
import { matchDecks, startDeckPick } from "./deck-pick";

const DECKS: DeckLink[] = [
  { path: "projects/trip/talks/pitch.deck", title: "Trip pitch", hint: "Seaside trip" },
  { path: "library/review.deck", title: "Quarterly review" },
  { path: "library/trip-notes.deck", title: "Notes for the trip" },
];

const links: LinkProvider = {
  pages: () => [],
  open: vi.fn(),
  decks: () => DECKS,
  createDeck: vi.fn(async (title: string) => `library/${title.toLowerCase().replace(/\s+/g, "-")}.deck`),
};
const editor = useTestEditor({ links });
const items = () => [...document.querySelectorAll<HTMLElement>(".kasten-menu .kasten-menu-item")];
const keys = () => items().map((i) => i.dataset.key);
const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Opens the menu in a new empty paragraph at the end of `body`. */
function openAtEnd(body: string): number {
  editor.open(body);
  const { view } = editor;
  const size = view.state.doc.content.size;
  const tr = view.state.tr.insert(size, view.state.schema.nodes.paragraph!.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, size + 1)));
  startDeckPick(view, editor.ctx, size + 1);
  return size + 1;
}

afterEach(() => {
  press("Escape");
  document.querySelector(".kasten-menu")?.remove();
  vi.clearAllMocks();
});

describe("/deck", () => {
  it("is offered among the blocks, and found by what it is called elsewhere", () => {
    expect(SLASH_CHOICES.find((c) => c.key === "deck")).toMatchObject({ label: "Deck", action: { type: "deck" } });
    expect(matchChoices(SLASH_CHOICES, "slides")[0]!.key).toBe("deck");
    expect(matchChoices(SLASH_CHOICES, "deck")[0]!.key).toBe("deck");
  });

  it("matches decks by title, those starting with the words first", () => {
    expect(matchDecks(DECKS, "trip").map((d) => d.title)).toEqual(["Trip pitch", "Notes for the trip"]);
    expect(matchDecks(DECKS, "").map((d) => d.path)).toHaveLength(3);
    expect(matchDecks(DECKS, "zzz")).toEqual([]);
  });

  it("lists the decks and a new one, narrows as you type, and embeds the pick", () => {
    openAtEnd("Intro\n");
    expect(keys()).toEqual(["deck:projects/trip/talks/pitch.deck", "deck:library/review.deck", "deck:library/trip-notes.deck", "create"]);
    press("r");
    press("e");
    press("v");
    expect(keys()).toEqual(["deck:library/review.deck", "create"]);
    expect(items()[1]!.textContent).toContain("New deck “rev”");
    press("Backspace");
    press("Backspace");
    press("Backspace");
    expect(keys()).toHaveLength(4);
    press("p");
    press("Enter");
    expect(editor.save()).toBe("Intro\n\n![[projects/trip/talks/pitch.deck]]\n");
    expect(document.querySelector(".kasten-menu")).toBeNull();
  });

  it("makes a new deck from what was typed, and puts it where it was asked for", async () => {
    openAtEnd("Intro\n");
    for (const key of "Plan") press(key);
    items().find((i) => i.dataset.key === "create")!.click();
    await settle();
    await settle();
    expect(links.createDeck).toHaveBeenCalledWith("Plan");
    expect(editor.save()).toBe("Intro\n\n![[library/plan.deck]]\n");
  });

  it("goes with Escape, leaving the page alone", () => {
    openAtEnd("Intro\n");
    press("Escape");
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(editor.save()).toBe("Intro\n");
  });
});
