// "Turn off slide numbers in every deck…": the decks that show them are looked at and listed, the ones that cannot be read are listed apart, and
// nothing is written until the person says so, then every deck or none, with an Undo.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultClient } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { onDeckFiles } from "./events";
import { decksWithNumbers, numbersMessage } from "./slide-numbers";
import { SlideNumbersDialog, SlideNumbersHost } from "./SlideNumbersDialog";
import { useSlideNumbers } from "./slide-numbers-state";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

/** A deck as one saved before new decks had slide numbers off. */
function deckText(title: string, numbers: boolean): string {
  const engine = DeckEngine.create(title, "Light", 5);
  engine.apply("add_slide", { layout: "title-body", content: { title: "Results", body: "one" } });
  engine.apply("set_present", { slideNumbers: numbers });
  const text = engine.save();
  engine.dispose();
  return text;
}

/** The decks of the vault: two that show slide numbers, one that does not, one that is not a deck. Made once the engine is loaded. */
const seed = () => ({
  "library/numbered.deck": deckText("Numbered", true),
  "projects/trip/decks/also-numbered.deck": deckText("Also numbered", true),
  "library/plain.deck": deckText("Plain", false),
  "library/broken.deck": "{ nope",
});

let vault: MemoryVault;
beforeEach(async () => {
  vault = new MemoryVault({ "projects/trip/_project.md": "---\ntitle: Trip\n---\n", ...seed() });
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), recent: [], toasts: [] });
  useSlideNumbers.setState({ open: true });
});
afterEach(cleanup);

const said = () => useWorkspace.getState().toasts.map((t) => t.text).join(" ");
const slideNumbers = async (path: string) => (JSON.parse((await vault.deck(path)).text) as { present: { slideNumbers: boolean } }).present.slideNumbers;

describe("looking at the decks", () => {
  it("finds the decks that show slide numbers, with the text they would have without, and lists a deck that cannot be read apart", async () => {
    const found = await decksWithNumbers(vault);
    expect(found.looked).toBe(4);
    expect(found.affected.map((deck) => deck.path).sort()).toEqual(["library/numbered.deck", "projects/trip/decks/also-numbered.deck"]);
    for (const deck of found.affected) {
      expect(JSON.parse(deck.text).present.slideNumbers).toBe(false);
      expect(deck.baseHash).toBe((await vault.deck(deck.path)).hash);
    }
    expect(found.unreadable.map((deck) => deck.path)).toEqual(["library/broken.deck"]);
    expect(found.unreadable[0]?.why).toMatch(/Not a KastenFlow deck/);
    // Looking writes nothing.
    expect(await slideNumbers("library/numbered.deck")).toBe(true);
  });

  it("says a deck that cannot be opened by this build is unreadable, whatever its envelope says", async () => {
    await vault.createDeck("Newer", null, JSON.stringify({ format: "kasten-deck", formatVersion: 99, title: "Newer", slides: [] }));
    const found = await decksWithNumbers(vault);
    expect(found.unreadable.map((deck) => deck.title).sort()).toEqual(["Newer", "broken"]);
  });

  it("words the message the history keeps", () => {
    expect(numbersMessage(1)).toBe("slides: turn off slide numbers in 1 deck");
    expect(numbersMessage(3)).toBe("slides: turn off slide numbers in 3 decks");
  });
});

describe("the dialog", () => {
  it("lists the decks that show them and the ones it cannot read, and writes nothing until asked", async () => {
    render(<SlideNumbersDialog />);
    const list = await screen.findByRole("list", { name: "Decks that show slide numbers" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Numbered"), expect.stringContaining("Also numbered")]));
    expect(within(screen.getByRole("region", { name: "Decks that could not be read" })).getByText(/Not a KastenFlow deck/)).toBeTruthy();
    expect(screen.getByText(/2 of your 4 decks show slide numbers/)).toBeTruthy();
    expect(await slideNumbers("library/numbered.deck")).toBe(true);
    expect(screen.getByRole("button", { name: "Turn off in 2 decks" })).toBeTruthy();
  });

  it("turns them off in every deck at once, tells the open editors, closes, and says so", async () => {
    const heard: string[][] = [];
    const stop = onDeckFiles((paths) => heard.push(paths));
    render(<SlideNumbersDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off in 2 decks" }));
    await waitFor(() => expect(useSlideNumbers.getState().open).toBe(false));
    stop();
    expect(await slideNumbers("library/numbered.deck")).toBe(false);
    expect(await slideNumbers("projects/trip/decks/also-numbered.deck")).toBe(false);
    expect((await vault.deck("library/broken.deck")).text).toBe("{ nope");
    expect(heard.flat().sort()).toEqual(["library/numbered.deck", "projects/trip/decks/also-numbered.deck"]);
    expect(said()).toContain("Turned slide numbers off in 2 decks.");
  });

  it("says when there is nothing to change", async () => {
    await vault.saveDecks({ message: "slides: off", edits: await Promise.all(["library/numbered.deck", "projects/trip/decks/also-numbered.deck"].map(async (path) => ({ path, baseHash: (await vault.deck(path)).hash, text: deckText(path, false) }))) });
    render(<SlideNumbersDialog />);
    expect(await screen.findByText(/No deck shows slide numbers/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Turn off" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes nothing when a deck changed while it was open, says so, and looks again", async () => {
    render(<SlideNumbersDialog />);
    const button = await screen.findByRole("button", { name: "Turn off in 2 decks" });
    // Someone saved the first deck meanwhile.
    const path = "library/numbered.deck";
    const current = await vault.deck(path);
    await vault.saveDeck(path, deckText("Numbered, edited elsewhere", true), current.hash);
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("nothing was saved");
    expect(await slideNumbers(path)).toBe(true);
    expect(await slideNumbers("projects/trip/decks/also-numbered.deck")).toBe(true);
    expect(useSlideNumbers.getState().open).toBe(true);
    // The list is made again from the decks as they are now, so a second try goes through.
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off in 2 decks" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Turn off in 2 decks" }));
    await waitFor(() => expect(useSlideNumbers.getState().open).toBe(false));
    expect(await slideNumbers(path)).toBe(false);
  });

  it("offers Undo where the vault kept one change, and puts the numbers back through it", async () => {
    const undone = vi.fn(async () => ({ reverted: ["c1"], conflict: null }));
    const client = Object.assign(Object.create(vault) as VaultClient, {
      saveDecks: async (request: Parameters<VaultClient["saveDecks"]>[0]) => ({ ...(await vault.saveDecks(request)), commit: "c1" }),
      undoCommit: undone,
    });
    useWorkspace.setState({ client });
    render(<SlideNumbersDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off in 2 decks" }));
    await waitFor(() => expect(useWorkspace.getState().toasts.some((t) => t.action?.label === "Undo")).toBe(true));
    const toast = useWorkspace.getState().toasts.find((t) => t.action?.label === "Undo")!;
    await act(async () => toast.action!.run());
    expect(undone).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(said()).toContain("Slide numbers are back."));
  });

  it("is shown by the host only while it is asked for", () => {
    useSlideNumbers.setState({ open: false });
    const { container } = render(<SlideNumbersHost />);
    expect(container.textContent).toBe("");
    act(() => useSlideNumbers.getState().show());
    expect(screen.getByRole("dialog", { name: "Turn off slide numbers in every deck" })).toBeTruthy();
  });
});
