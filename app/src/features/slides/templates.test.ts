// The templates a person keeps: decks in the vault's `templates/slides/`, read, started from, renamed, copied and trashed.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import type { VaultClient } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { deckFromTemplate, duplicateTemplate, readTemplate, renameTemplate, trashTemplate } from "./templates";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

/** A template made the way the editor makes one: the look of a deck with a layout of its own, kept as a template. */
async function vaultWithTemplate(title = "Pitch with a stripe") {
  const vault = new MemoryVault({});
  const engine = DeckEngine.create("Source", "Pitch", 3, { size: { w: 960, h: 720 }, examples: true });
  const first = engine.deck.slides[0]!.id;
  engine.apply("save_layout", { slide: first, label: "Side stripe", roles: {}, useForSlide: false });
  const path = await vault.createDeckTemplate(title, engine.templateText(title, true, 4));
  engine.dispose();
  return { vault: vault as unknown as VaultClient, path };
}

describe("a template in the vault", () => {
  it("is a deck file under templates/slides that the list of decks leaves out", async () => {
    const { vault, path } = await vaultWithTemplate();
    expect(path).toBe("templates/slides/pitch-with-a-stripe.deck");
    expect((await vault.deckTemplates()).map((t) => [t.path, t.title, t.slides])).toEqual([[path, "Pitch with a stripe", 7]]);
    expect(await vault.decks()).toEqual([]);
    const file = await readTemplate(vault, path);
    expect(file.deck.theme.layouts.some((layout) => layout.name === "side-stripe")).toBe(true);
    expect(file.deck.size).toMatchObject({ w: 960, h: 720 });
  });

  it("starts a deck of its own: the template's look and shape under a new id and title, with its slides or one title slide", async () => {
    const { vault, path } = await vaultWithTemplate();
    const withSlides = DeckEngine.open(await deckFromTemplate(vault, path, "Quarterly review", true));
    expect(withSlides.deck.title).toBe("Quarterly review");
    expect(withSlides.deck.size).toMatchObject({ w: 960, h: 720 });
    expect(withSlides.deck.slides).toHaveLength(7);
    expect(withSlides.deck.theme.layouts.some((layout) => layout.name === "side-stripe")).toBe(true);
    expect(withSlides.canUndo).toBe(false);
    const plain = DeckEngine.open(await deckFromTemplate(vault, path, "Short", false));
    expect(plain.deck.slides).toHaveLength(1);
    expect(plain.deck.id).not.toBe((await readTemplate(vault, path)).deck.id);
  });

  it("is renamed by saving it with another title, and keeps its file", async () => {
    const { vault, path } = await vaultWithTemplate();
    await renameTemplate(vault, path, "  Stripe look  ");
    const [listed] = await vault.deckTemplates();
    expect([listed?.path, listed?.title]).toEqual([path, "Stripe look"]);
    await renameTemplate(vault, path, "   ");
    expect((await vault.deckTemplates())[0]?.title, "an empty name changes nothing").toBe("Stripe look");
  });

  it("is copied as a template of its own with its own id, and trashed without being deleted", async () => {
    const { vault, path } = await vaultWithTemplate();
    const copy = await duplicateTemplate(vault, path, "Stripe look copy");
    expect(copy).toBe("templates/slides/stripe-look-copy.deck");
    expect((await readTemplate(vault, copy)).deck.id).not.toBe((await readTemplate(vault, path)).deck.id);
    expect((await vault.deckTemplates()).map((t) => t.title).sort()).toEqual(["Pitch with a stripe", "Stripe look copy"]);
    await trashTemplate(vault, path);
    expect((await vault.deckTemplates()).map((t) => t.path)).toEqual([copy]);
    const [kept] = await vault.listTrash();
    expect(kept?.original).toBe(path);
    expect(await vault.restoreDeck(kept!.trashed)).toBe(path);
    expect(await vault.deckTemplates()).toHaveLength(2);
  });
});
