// "Turn sections into a deck": the page's sections become the slides of a new
// deck in the page's project, made with the real slide engine.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { useDecks } from "../../slides/store";
import { registerSections, type SectionsHandle } from "../editor/sections/registry";
import { addSlides, turnSectionsIntoDeck } from "./to-deck";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

const PLAN = "projects/trip/pages/plan.md";
const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  [PLAN]: "---\ntitle: Seaside trip\n---\nWords.\n",
  "library/loose.md": "---\ntitle: Loose [page]\n---\nWords.\n",
};

let vault: MemoryVault;
let forget: (() => void) | null = null;

/** A page's editor, as the registry knows it: what its sections say. */
function showing(page: string, sections: { title: string; markdown: string }[]): void {
  const dom = document.createElement("div");
  document.body.append(dom);
  const handle: SectionsHandle = { dom, page: () => page, foldAll: () => 0, present: () => sections.length, step: () => {}, stop: () => {}, texts: () => sections };
  const unregister = registerSections(handle);
  forget = () => {
    unregister();
    dom.remove();
  };
}

beforeEach(async () => {
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), recent: [], toasts: [] });
  useDecks.setState({ list: [], loaded: false });
});
afterEach(() => {
  forget?.();
  forget = null;
});

const note = (path: string) => useWorkspace.getState().notes.find((n) => n.path === path)!;
const said = () => useWorkspace.getState().toasts.map((t) => t.text).join(" ");

describe("turning sections into a deck", () => {
  it("makes a slide of each section in the page's project, and opens the deck", async () => {
    const page = note(PLAN);
    showing(page.id || page.path, [
      { title: "Plan", markdown: "## Plan\n\nBook early.\n\n- flights\n- guesthouse" },
      { title: "Budget", markdown: "## Budget\n\n![chart](assets/c.png)" },
      { title: "Thanks", markdown: "Questions?" },
    ]);
    await turnSectionsIntoDeck(page);
    const [made] = await vault.decks();
    expect(made, said()).toBeDefined();
    expect(made!.path.startsWith("projects/trip/decks/")).toBe(true);
    const deck = DeckEngine.open((await vault.deck(made!.path)).text).deck;
    expect(deck.title).toBe("Seaside trip");
    // A title slide, then one for each section.
    expect(deck.slides).toHaveLength(4);
    const text = (slide: (typeof deck.slides)[number]) => JSON.stringify(slide);
    expect(text(deck.slides[1]!)).toContain("flights");
    expect(text(deck.slides[1]!)).toContain("Book early.");
    expect(text(deck.slides[2]!)).toContain("Budget");
    expect(deck.slides[2]!.layout).toBe("section");
    expect(deck.slides[3]!.layout).toBe("title-body");
    expect(useDecks.getState().list.map((d) => d.path)).toEqual([made!.path]);
    expect(useWorkspace.getState().place.path).toBe(made!.path);
    expect(said()).toContain("3 sections");
    expect(said()).toContain("A picture was left out");
    // The page itself is not changed.
    expect((await vault.read(PLAN)).text).toBe(SEED[PLAN]);
  });

  it("names a deck with a plain title when the page's has brackets or bars, and keeps a loose page's deck in the library", async () => {
    const page = note("library/loose.md");
    showing(page.id || page.path, [{ title: "One", markdown: "- a" }]);
    await turnSectionsIntoDeck(page);
    const [made] = await vault.decks();
    expect(made!.path.startsWith("library/")).toBe(true);
    expect(made!.title).toBe("Loose page");
  });

  it("says so, and makes nothing, when the page is not open or has no sections", async () => {
    await turnSectionsIntoDeck(note(PLAN));
    expect(await vault.decks()).toEqual([]);
    expect(said()).toContain("nothing to turn into slides");
    const page = note(PLAN);
    showing(page.id || page.path, []);
    await turnSectionsIntoDeck(page);
    expect(await vault.decks()).toEqual([]);
  });

  it("adds a slide operation for each, a divider slide for a section with no words", () => {
    expect(addSlides([{ title: "A", layout: null, body: "- x", notes: "n", pictures: 0 }, { title: "B", layout: "section", body: "", notes: "", pictures: 0 }])).toEqual([
      ["add_slide", { content: { title: "A", body: "- x" }, notes: "n" }],
      ["add_slide", { layout: "section", content: { title: "B" }, notes: null }],
    ]);
  });
});
