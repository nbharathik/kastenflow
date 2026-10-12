// "New deck" in the Slides view: a gallery of templates with live thumbnails, the shape of the slides, and example slides.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultClient } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { NewDeck } from "./NewDeck";
import { useDecks } from "./store";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
  // A thumbnail is drawn at the width of its box, which a test page has no layout to give.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 210 });
});

beforeEach(() => {
  useDecks.setState({ creating: true, draftProject: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useWorkspace.setState({ client: null });
});

function fakeVault() {
  return {
    createDeck: vi.fn(async () => "library/talk.deck"),
    decks: vi.fn(async () => []),
  } as unknown as VaultClient;
}

const templates = () => within(screen.getByRole("radiogroup", { name: "Template" })).getAllByRole("radio");
const shapes = () => within(screen.getByRole("radiogroup", { name: "Slide shape" })).getAllByRole("radio");

/** The deck the form handed to the vault. */
const made = (client: VaultClient) => JSON.parse((client.createDeck as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string) as { size: { w: number; h: number }; theme: { name: string }; slides: { layout: string }[] };

describe("the template gallery", () => {
  it("has a card for every built-in theme, each drawn with a title slide and two example slides", async () => {
    useWorkspace.setState({ client: fakeVault(), notes: [] });
    render(<NewDeck />);
    await waitFor(() => expect(templates()).toHaveLength(11));
    expect(templates().map((card) => card.getAttribute("aria-label"))).toEqual([
      "Light template",
      "Dark template",
      "Serif template",
      "Lecture template",
      "Minimal template",
      "Bold template",
      "Modern template",
      "Academic template",
      "Pitch template",
      "Dark Studio template",
      "Warm Paper template",
    ]);
    await waitFor(() => expect(templates().every((card) => card.querySelectorAll(".ks-slide").length === 3)).toBe(true));
    expect(templates()[0]?.getAttribute("aria-checked")).toBe("true");
  });

  it("picks one at a time", async () => {
    useWorkspace.setState({ client: fakeVault(), notes: [] });
    render(<NewDeck />);
    await waitFor(() => expect(templates()).toHaveLength(11));
    fireEvent.click(screen.getByRole("radio", { name: "Bold template" }));
    expect(screen.getByRole("radio", { name: "Bold template" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Light template" }).getAttribute("aria-checked")).toBe("false");
  });
});

/** A vault that keeps a template of its own: the look of a Pitch deck with a layout added, at 4:3. */
async function vaultWithTemplate() {
  const vault = new MemoryVault({});
  const engine = DeckEngine.create("Source", "Pitch", 3, { size: { w: 960, h: 720 }, examples: true });
  engine.apply("save_layout", { slide: engine.deck.slides[0]!.id, label: "Side stripe", roles: {}, useForSlide: false });
  const path = await vault.createDeckTemplate("Pitch look", engine.templateText("Pitch look", true, 4));
  engine.dispose();
  return { vault, path };
}

describe("my templates", () => {
  it("says how to make one while there are none, and the built-in ones are all still there", async () => {
    useWorkspace.setState({ client: fakeVault(), notes: [] });
    render(<NewDeck />);
    expect(within(screen.getByRole("region", { name: "My templates" })).getByText(/choose File, Save as template/)).toBeTruthy();
    await waitFor(() => expect(templates()).toHaveLength(11));
  });

  it("lists the templates of the vault with their own layouts drawn, and makes a deck of the one picked in its shape", async () => {
    // Thumbnails of layouts are drawn as they come into view: here everything is in view at once.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly report: IntersectionObserverCallback) {}
        observe(target: Element) {
          this.report([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { vault, path } = await vaultWithTemplate();
    const openPath = vi.fn();
    useWorkspace.setState({ client: vault as unknown as VaultClient, openPath, notes: [] });
    render(<NewDeck />);
    const mine = await screen.findByRole("radiogroup", { name: "My templates" });
    const card = within(mine).getByRole("radio", { name: "Pitch look template" });
    expect(templates(), "the built-in ones stay apart").toHaveLength(11);
    await waitFor(() => expect(card.querySelectorAll(".ks-slide").length).toBeGreaterThan(1));
    fireEvent.click(card);
    expect(card.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radiogroup", { name: "Slide shape" }), "the shape is the template's").toBeNull();
    expect(screen.getByText("The slides take the shape of the template.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Quarterly review" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(openPath).toHaveBeenCalled());
    const [made] = (await vault.decks()).filter((deck) => deck.title === "Quarterly review");
    const deck = DeckEngine.open((await vault.deck(made!.path)).text).deck;
    expect(deck.size).toEqual({ w: 960, h: 720 });
    expect(deck.theme.layouts.some((layout) => layout.name === "side-stripe")).toBe(true);
    expect(deck.slides).toHaveLength(7);
    expect((await vault.deckTemplates()).map((t) => t.path), "the template itself is untouched").toEqual([path]);
  });

  it("starts from its slides, or from one title slide when the example slides are turned off", async () => {
    const { vault } = await vaultWithTemplate();
    useWorkspace.setState({ client: vault as unknown as VaultClient, openPath: vi.fn(), notes: [] });
    render(<NewDeck />);
    fireEvent.click(await screen.findByRole("radio", { name: "Pitch look template" }));
    fireEvent.click(screen.getByLabelText("Include example slides"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(async () => expect((await vault.decks()).some((deck) => deck.title === "Short")).toBe(true));
    const [made] = (await vault.decks()).filter((deck) => deck.title === "Short");
    expect(made?.slides).toBe(1);
  });

  it("renames, copies and trashes a template from its card", async () => {
    const { vault, path } = await vaultWithTemplate();
    useWorkspace.setState({ client: vault as unknown as VaultClient, openPath: vi.fn(), notes: [] });
    render(<NewDeck />);
    const actions = await screen.findByRole("group", { name: "Actions for Pitch look" });
    fireEvent.click(within(actions).getByRole("button", { name: "Rename" }));
    const name = screen.getByLabelText("Name of Pitch look");
    fireEvent.change(name, { target: { value: "Pitch, mine" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(async () => expect((await vault.deckTemplates())[0]?.title).toBe("Pitch, mine"));
    await screen.findByRole("radio", { name: "Pitch, mine template" });

    fireEvent.click(within(screen.getByRole("group", { name: "Actions for Pitch, mine" })).getByRole("button", { name: "Duplicate" }));
    await waitFor(async () => expect(await vault.deckTemplates()).toHaveLength(2));
    expect((await vault.deckTemplates()).map((t) => t.title).sort()).toEqual(["Pitch, mine", "Pitch, mine copy"]);

    fireEvent.click(within(screen.getByRole("group", { name: "Actions for Pitch, mine" })).getByRole("button", { name: "Trash" }));
    await waitFor(async () => expect((await vault.deckTemplates()).map((t) => t.path)).not.toContain(path));
    expect((await vault.listTrash()).some((item) => item.original === path)).toBe(true);
  });
});

describe("making a deck", () => {
  it("makes a deck of the template, the shape and the example slides chosen, and opens it", async () => {
    const client = fakeVault();
    const openPath = vi.fn();
    useWorkspace.setState({ client, openPath, notes: [] });
    render(<NewDeck />);
    await waitFor(() => expect(templates()).toHaveLength(11));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Quarterly review" } });
    fireEvent.click(screen.getByRole("radio", { name: "Academic template" }));
    expect(shapes().map((shape) => shape.textContent)).toEqual(["16:9", "16:10", "4:3", "1:1"]);
    fireEvent.click(shapes()[2]!);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("library/talk.deck"));
    const deck = made(client);
    expect(deck.theme.name).toBe("Academic");
    expect(deck.size).toEqual({ w: 960, h: 720 });
    expect(deck.slides.map((slide) => slide.layout)).toEqual(["title", "section", "title-body", "two-columns", "title-image", "quote", "title"]);
  });

  it("makes a deck of a title slide alone when the example slides are turned off", async () => {
    const client = fakeVault();
    useWorkspace.setState({ client, openPath: vi.fn(), notes: [] });
    render(<NewDeck />);
    expect((screen.getByLabelText("Include example slides") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Include example slides"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plain" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(client.createDeck).toHaveBeenCalled());
    const deck = made(client);
    expect(deck.slides).toHaveLength(1);
    expect(deck.size).toEqual({ w: 960, h: 540 });
  });

  it("is the deck a plain DeckEngine makes at that size, so the vault gets what the editor reads", async () => {
    const client = fakeVault();
    useWorkspace.setState({ client, openPath: vi.fn(), notes: [] });
    render(<NewDeck />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Square" } });
    fireEvent.click(shapes()[3]!);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(client.createDeck).toHaveBeenCalled());
    const text = (client.createDeck as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    const again = DeckEngine.open(text);
    expect(again.save()).toBe(text);
    expect(again.deck.size).toMatchObject({ w: 720, h: 720 });
  });
});
