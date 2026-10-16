// The deck of a storyboard, with the real slide engine and the preview's vault.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, draftStoryboard, loadSlides, pageFingerprint, pageSection } from "@kasten-slides/wasm";
import type { Deck, StoryEntry } from "@kasten-slides/wasm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MINE } from "../../../slides/TemplateGallery";
import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { deckName, generateDeck } from "./generate";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

const PAGE = "## Plan\n\nBook early. Then pack.\n\n- flights\n- guesthouse\n\n![far](https://example.com/a.png)\n\n## Budget\n\n- bed: 40\n";
let vault: MemoryVault;
let entries: StoryEntry[];

beforeEach(() => {
  vault = new MemoryVault({ "projects/trip/_project.md": "---\ntitle: Trip\n---\n" });
  entries = draftStoryboard({ page: "projects/trip/pages/plan.md", id: "n-1", title: "Seaside trip", markdown: PAGE });
});

const read = async (path: string): Promise<Deck> => DeckEngine.open((await vault.deck(path)).text).deck;

describe("making the deck", () => {
  it("makes a deck in the project: the title slide, then a slide for each entry that remembers its section", async () => {
    const made = await generateDeck(vault, { title: "Seaside trip", project: "trip", entries, template: "Dark", shape: "16:9" });
    expect(made.path).toBe("projects/trip/decks/seaside-trip.deck");
    expect(made.slides).toBe(2);
    const deck = await read(made.path);
    expect(deck.theme.name).toBe("Dark");
    expect(deck.slides).toHaveLength(3);
    const plan = deck.slides[1]!;
    const body = plan.elements.find((e) => e.source != null)!;
    expect(body.source).toMatchObject({ page: "projects/trip/pages/plan.md", id: "n-1", section: "Plan", kind: "section", sync: true, hash: pageFingerprint(pageSection(PAGE, "Plan")!) });
    expect(body.source?.made).toMatch(/^[0-9a-f]{16}$/);
    expect(plan.notes).toBe("Book early. Then pack.");
    // The deck needs version 2 to say how its slides were made.
    expect(JSON.parse((await vault.deck(made.path)).text).formatVersion).toBe(2);
  });

  it("reports what was left out: a picture from the web", async () => {
    const made = await generateDeck(vault, { title: "Trip", project: null, entries, template: "Light", shape: "16:9" });
    expect(made.path.startsWith("library/")).toBe(true);
    const picture = made.omitted.find((item) => item.what === "picture");
    expect(picture).toMatchObject({ entry: 0 });
    expect(picture?.reason).toContain("https://example.com/a.png");
  });

  it("makes it in the shape asked for, as part of the same batch", async () => {
    const made = await generateDeck(vault, { title: "Trip", project: null, entries, template: "Light", shape: "4:3" });
    const deck = await read(made.path);
    expect(deck.size).toEqual({ w: 960, h: 720 });
    // The slides are fitted to it: nothing sticks out past the edge.
    for (const slide of deck.slides) for (const element of slide.elements) if (element.y != null && element.h != null) expect(element.y + element.h).toBeLessThanOrEqual(720.01);
  });

  it("starts from a template of the person's own, which sets the shape unless one is asked for", async () => {
    const source = DeckEngine.create("Mine", "Serif", 3, { size: { w: 960, h: 720 } });
    const template = await vault.createDeckTemplate("My template", source.templateText("My template", false));
    source.dispose();
    const own = await generateDeck(vault, { title: "Trip", project: null, entries, template: `${MINE}${template}`, shape: "" });
    const first = await read(own.path);
    expect(first.size).toEqual({ w: 960, h: 720 });
    expect(first.theme.name).toBe("Serif");
    const wide = await generateDeck(vault, { title: "Trip wide", project: null, entries, template: `${MINE}${template}`, shape: "16:9" });
    expect((await read(wide.path)).size).toEqual({ w: 960, h: 540 });
  });

  it("makes a plain name of a title with brackets, bars or line breaks, and refuses a vault that will not have it", async () => {
    expect(deckName("A [b] | c\nd")).toBe("A b c d");
    expect(deckName("[]")).toBe("Deck");
    await expect(generateDeck(vault, { title: "Trip", project: "nope", entries, template: "Light", shape: "16:9" })).rejects.toThrow("No project called nope");
  });

  it("makes the same deck from the same storyboard however many times it is asked", async () => {
    const one = await generateDeck(vault, { title: "Trip", project: null, entries, template: "Light", shape: "16:9" });
    const two = await generateDeck(vault, { title: "Trip", project: null, entries, template: "Light", shape: "16:9" });
    expect(two.path).not.toBe(one.path);
    expect((await read(two.path)).slides.map((s) => s.layout)).toEqual((await read(one.path)).slides.map((s) => s.layout));
  });
});
