import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { DeckEngine, SlidesError, builtInThemes, loadSlides, operationSpecs, supportedFormatVersion } from "./index.ts";
import { OP_NAMES } from "./generated/ops.ts";

beforeAll(async () => {
  await loadSlides(await readFile(new URL("../pkg/slides_wasm_bg.wasm", import.meta.url)));
});

/** Sorted keys, so two decks compare by content. */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v)));
}

/** The saved file, compared by content: its `formatVersion` line says 1 until the deck uses a
 * version 2 field, while the engine's copy always says the newest version it can read. */
const saved = (engine: DeckEngine): unknown => plain({ ...(JSON.parse(engine.save()) as object), formatVersion: engine.deck.formatVersion });

describe("the engine", () => {
  it("makes a deck and reports the format version", () => {
    expect(supportedFormatVersion()).toBe(2);
    const engine = DeckEngine.create("Talk", "Light", 1);
    expect(engine.deck.title).toBe("Talk");
    expect(engine.deck.slides).toHaveLength(1);
    expect(builtInThemes()).toContain("Lecture");
  });

  it("keeps its plain copy of the deck in step with the engine through every change", () => {
    const engine = DeckEngine.create("Talk", "Light", 2);
    const seen: number[] = [];
    engine.subscribe((deck) => seen.push(deck.slides.length));
    const added = engine.apply("add_slide", { layout: "title-body", content: { title: "Results", body: "- a\n- b" } });
    expect(added.output.slide).toMatch(/^s-/);
    expect(plain(engine.deck)).toEqual(saved(engine));
    engine.apply("set_notes", { slide: added.output.slide, notes: "hello" });
    expect(plain(engine.deck)).toEqual(saved(engine));
    engine.undo();
    engine.undo();
    expect(engine.deck.slides).toHaveLength(1);
    expect(plain(engine.deck)).toEqual(saved(engine));
    engine.redo();
    expect(engine.deck.slides).toHaveLength(2);
    expect(plain(engine.deck)).toEqual(saved(engine));
    expect(seen).toEqual([2, 2, 2, 1, 2]);
    expect(engine.canUndo && engine.canRedo).toBe(true);
    expect(engine.undoLabel).toBe("add_slide");
  });

  it("shares every slide that did not change", () => {
    const engine = DeckEngine.create("Talk", "Light", 3);
    const second = engine.apply("add_slide", { layout: "blank" }).output.slide;
    const [first, other] = engine.deck.slides;
    engine.apply("set_notes", { slide: second, notes: "changed" });
    expect(engine.deck.slides[0]).toBe(first);
    expect(engine.deck.slides[1]).not.toBe(other);
    expect(engine.deck.slides[1]?.notes).toBe("changed");
  });

  it("throws a SlidesError with its kind, and changes nothing", () => {
    const engine = DeckEngine.create("Talk", "Light", 4);
    const before = engine.save();
    let thrown: unknown;
    try {
      engine.apply("add_slide", { layout: "nope" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SlidesError);
    expect((thrown as SlidesError).kind).toBe("badInput");
    expect((thrown as SlidesError).message).toContain("title-body");
    expect(engine.save()).toBe(before);
    expect(engine.canUndo).toBe(false);
  });

  it("applies a batch as one step", () => {
    const engine = DeckEngine.create("Talk", "Light", 5);
    const first = engine.deck.slides[0]?.id ?? "";
    engine.applyBatch([
      ["set_title", { title: "Batch" }],
      ["set_notes", { slide: first, notes: "n" }],
    ]);
    expect(engine.deck.title).toBe("Batch");
    expect(engine.deck.slides[0]?.notes).toBe("n");
    engine.undo();
    expect(engine.deck.title).toBe("Talk");
    expect(engine.deck.slides[0]?.notes ?? "").toBe("");
    expect(engine.canUndo).toBe(false);
  });

  it("makes a deck with the slide numbers off, and turns them on and off as one step each", () => {
    const engine = DeckEngine.create("Talk", "Light", 9);
    expect(engine.deck.present.slideNumbers).toBe(false);
    engine.apply("set_present", { slideNumbers: true });
    expect(engine.deck.present.slideNumbers).toBe(true);
    expect(plain(engine.deck)).toEqual(saved(engine));
    expect(engine.undoLabel).toBe("set_present");
    engine.undo();
    expect(engine.deck.present.slideNumbers).toBe(false);
    // Asking for what already is leaves nothing to undo.
    const quiet = DeckEngine.create("Talk", "Light", 9);
    quiet.apply("set_present", { slideNumbers: false });
    expect(quiet.canUndo).toBe(false);
  });

  it("joins an operation to the last step when that step covers it, and keeps the copy of the deck in step", () => {
    const engine = DeckEngine.create("Talk", "Light", 10);
    const slide = engine.apply("add_slide", { layout: "blank" }).output.slide;
    const before = engine.save();
    const box = { type: "text", id: "", x: 10, y: 10, w: 200, h: 50, text: { paragraphs: [{ runs: [{ t: "" }] }] } } as const;
    const id = engine.apply("add_elements", { slide, elements: [box as never] }).output.ids[0] ?? "";
    engine.applyIntoLast("set_rich_text", { slide, id, text: { paragraphs: [{ runs: [{ t: "Hello" }] }] } });
    expect(plain(engine.deck)).toEqual(saved(engine));
    expect(JSON.stringify(engine.deck.slides[1])).toContain("Hello");
    expect(engine.undoLabel).toBe("add_elements");
    engine.undo();
    expect(engine.save()).toBe(before);
    expect(plain(engine.deck)).toEqual(saved(engine));
    engine.redo();
    expect(JSON.stringify(engine.deck.slides[1])).toContain("Hello");
  });

  it("opens the text it saved", () => {
    const engine = DeckEngine.create("Talk", "Serif", 6);
    engine.apply("add_slide", { layout: "quote", content: { quote: "Be brief." } });
    const again = DeckEngine.open(engine.save(), 7);
    expect(plain(again.deck)).toEqual(plain(engine.deck));
    expect(() => DeckEngine.open("{}", 8)).toThrowError(SlidesError);
  });

  it("keeps the fields a newer build wrote, in every kind of object, through a save and a change that has nothing to do with them", async () => {
    const text = await readFile(new URL("../../../fixtures/decks/unknown-fields-deep.deck", import.meta.url), "utf8");
    const planted = (s: string): number => s.match(/"future/g)?.length ?? 0;
    expect(planted(text)).toBeGreaterThan(40);
    const engine = DeckEngine.open(text, 9);
    expect(engine.save()).toBe(text);
    // The copy the editor reads holds them too, so a value it hands back to an operation keeps them.
    expect(planted(JSON.stringify(engine.deck))).toBe(planted(text));
    engine.apply("set_title", { title: "Another title" });
    expect(planted(engine.save())).toBe(planted(text));
    engine.undo();
    expect(engine.save()).toBe(text);
  });

  it("describes every operation, matching the generated list", () => {
    const specs = operationSpecs();
    expect(specs.map((s) => s.name)).toEqual([...OP_NAMES]);
    expect(specs.every((s) => s.about.length > 20)).toBe(true);
  });
});
