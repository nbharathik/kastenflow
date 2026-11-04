import type { Deck } from "@kasten-slides/wasm";
import { DeckEngine } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { changedCount, compareDecks } from "./compare.ts";
import { DeckHistoryDialog } from "./DeckHistoryDialog.tsx";
import type { DeckVersion } from "./history-host.ts";

afterEach(cleanup);

const words = (t: string) => ({ paragraphs: [{ runs: [{ t }] }] });

/** A deck with a cover and `titles.length` slides, each a blank slide with a text box of its title. */
async function deckOf(titles: string[]): Promise<DeckEngine> {
  const engine = await newDeck("History", "Light");
  for (const title of titles) {
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    engine.apply("add_elements", { slide, elements: [{ type: "text", id: `t-${title}`, x: 40, y: 40, w: 300, h: 60, text: words(title) }] as never });
  }
  return engine;
}

const slideTitles = (deck: Deck): string[] => deck.slides.slice(1).map((s) => (s.elements[0] as { text: { paragraphs: { runs: { t: string }[] }[] } }).text.paragraphs[0]!.runs[0]!.t);

describe("comparing two versions", () => {
  it("marks the slides that are the same, changed, added and removed, in the order of the newer with removed ones where they stood", async () => {
    const older = (await deckOf(["A", "B", "C"])).deck;
    // The newer one: A as it was, B changed in place, C gone, D new.
    const newer = structuredClone(older);
    const [cover, a, b] = newer.slides;
    (b!.elements[0] as { text: { paragraphs: { runs: { t: string }[] }[] } }).text.paragraphs[0]!.runs[0]!.t = "B, changed";
    newer.slides = [cover!, a!, b!, { ...structuredClone(a!), id: "s-new" }];
    const rows = compareDecks(older, newer);
    expect(rows.map((r) => [r.id === "s-new" ? "new" : older.slides.findIndex((s) => s.id === r.id), r.how])).toEqual([
      [0, "same"],
      [1, "same"],
      [2, "changed"],
      [3, "removed"],
      ["new", "added"],
    ]);
    expect(changedCount(rows)).toBe(3);
    expect(rows[3]?.after).toBeNull();
    expect(rows[4]?.before).toBeNull();
  });

  it("calls every slide changed when the theme changes, and none when nothing did", async () => {
    const deck = (await deckOf(["A"])).deck;
    expect(changedCount(compareDecks(deck, structuredClone(deck)))).toBe(0);
    const other = structuredClone(deck);
    other.theme.colors.accent1 = "#123456";
    expect(compareDecks(deck, other).every((r) => r.how === "changed")).toBe(true);
  });
});

describe("Deck → History", () => {
  /** An editor on the deck as it is now (cover, A, B, C), with a host that kept two earlier versions. */
  async function open(options: { versions?: DeckVersion[]; fail?: boolean } = {}) {
    localStorage.clear();
    const old1 = await deckOf(["A"]);
    const old2 = await deckOf(["A", "B"]);
    const texts = new Map<string, string>([
      ["v1", old1.save()],
      ["v2", old2.save()],
    ]);
    const host = new MemoryHost();
    host.history = {
      versions: async () => {
        if (options.fail) throw new Error("no history");
        return options.versions ?? [
          { id: "v2", time: Date.parse("2026-11-02T10:00:00Z"), author: "You", summary: "deck: save History" },
          { id: "v1", time: Date.parse("2026-11-02T09:00:00Z"), author: "Assistant (chat)", summary: "deck: save History" },
        ];
      },
      read: async (id) => texts.get(id),
    };
    const now = await deckOf(["A", "B", "C"]);
    const session = new EditorSession(now, host, { saveDelay: 60_000 });
    const ui = new EditorUi();
    let closed = 0;
    render(<DeckHistoryDialog session={session} ui={ui} onClose={() => (closed += 1)} />);
    return { session, host, closed: () => closed };
  }

  it("lists the saved versions, newest first, and shows the slides that differ from the deck as it is now", async () => {
    await open();
    const select = (await screen.findByLabelText("Version")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["v2", "v1"]);
    expect(select.options[1]?.textContent).toContain("Assistant (chat)");
    expect((screen.getByLabelText("Compare with") as HTMLSelectElement).value).toBe("current");
    await screen.findByText("1 of 4 slides differ.");
    const rows = document.querySelectorAll(".ks-hs-row.is-added, .ks-hs-row.is-changed, .ks-hs-row.is-removed");
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText("Added")).toBeTruthy();
  });

  it("compares any two versions, and can show every slide", async () => {
    await open();
    await screen.findByText("1 of 4 slides differ.");
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Compare with"), { target: { value: "v2" } });
    await screen.findByText("1 of 3 slides differ.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Only slides that differ/ }));
    expect(document.querySelectorAll(".ks-hs-row")).toHaveLength(3);
  });

  it("brings an old version back as one step that can be undone, saved as a new version, and closes", async () => {
    const { session, host, closed } = await open();
    await screen.findByText("1 of 4 slides differ.");
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "v1" } });
    await screen.findByText("2 of 4 slides differ.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore as new version" }));
    });
    expect(slideTitles(session.deck)).toEqual(["A"]);
    expect(session.state.undoLabel).toBeTruthy();
    expect(closed()).toBe(1);
    await waitFor(() => expect(host.saves.length).toBeGreaterThan(0));
    expect(DeckEngine.open(host.saves.at(-1)!).deck.slides).toHaveLength(2);
    act(() => session.undo());
    expect(slideTitles(session.deck)).toEqual(["A", "B", "C"]);
  });

  it("says so when there is no version, and when the versions cannot be read", async () => {
    await open({ versions: [] });
    expect(await screen.findByText(/no saved versions yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restore as new version" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await open({ fail: true });
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
