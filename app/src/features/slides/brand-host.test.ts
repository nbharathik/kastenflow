import { describe, expect, it, vi } from "vitest";

import type { BrandKitFile, BrandKitSaved, VaultClient } from "../../lib/vault/types";
import { brandHost, projectOfDeck, startFromBrand } from "./brand-host";

const KIT = JSON.stringify({ format: "kasten-brand", formatVersion: 1, name: "Acme", colors: { accent1: "#0b5cad" } });

function clientWith(files: { vault?: string; project?: string }) {
  const read = vi.fn(async (project: string | null): Promise<BrandKitFile | null> => {
    const text = project !== null && files.project !== undefined ? files.project : files.vault;
    return text === undefined ? null : { path: "templates/brand/x.brand", project: project !== null && files.project !== undefined ? project : null, text, hash: "h", modified: 1 };
  });
  const save = vi.fn(async (_project: string | null, _text: string): Promise<BrandKitSaved> => ({ path: "templates/brand/x.brand", replaced: false, unchanged: false }));
  return { api: { brandKit: read, saveBrandKit: save } as unknown as VaultClient, read, save };
}

describe("the project of a deck", () => {
  it("is the folder under projects/, and none for a deck kept elsewhere", () => {
    expect(projectOfDeck("projects/Talks/decks/a.deck")).toBe("Talks");
    expect(projectOfDeck("library/decks/a.deck")).toBeNull();
    expect(projectOfDeck("projects")).toBeNull();
  });
});

describe("the brand host", () => {
  it("reads the kit of the deck's project and says whose it is", async () => {
    const { api, read } = clientWith({ vault: KIT, project: KIT });
    const { brand } = brandHost(api, "projects/Talks/decks/a.deck");
    expect(brand?.project).toBe("Talks");
    expect(await brand?.read()).toEqual({ text: KIT, scope: "project" });
    expect(read).toHaveBeenCalledWith("Talks");
  });

  it("reads the vault's kit for a deck in no project, and nothing when there is none", async () => {
    const found = brandHost(clientWith({ vault: KIT }).api, "library/decks/a.deck").brand;
    expect(found?.project).toBeNull();
    expect(await found?.read()).toEqual({ text: KIT, scope: "vault" });
    expect(await brandHost(clientWith({}).api, "library/decks/a.deck").brand?.read()).toBeNull();
  });

  it("keeps a kit for the project or for the vault", async () => {
    const { api, save } = clientWith({});
    const { brand } = brandHost(api, "projects/Talks/decks/a.deck");
    await brand?.save(KIT, "project");
    await brand?.save(KIT, "vault");
    expect(save.mock.calls).toEqual([
      ["Talks", KIT],
      [null, KIT],
    ]);
  });

  it("offers no kit where the client cannot keep one", () => {
    expect(brandHost({} as VaultClient, "projects/Talks/decks/a.deck")).toEqual({});
  });
});

describe("starting a deck from the brand", () => {
  it("does nothing, and fails nothing, where there is no kit or the client has none", async () => {
    const engine = { applyBatch: vi.fn() } as never;
    expect(await startFromBrand(clientWith({}).api, null, engine)).toBe(false);
    expect(await startFromBrand({} as VaultClient, null, engine)).toBe(false);
  });

  it("does nothing for a kit that cannot be read", async () => {
    const engine = { applyBatch: vi.fn() } as never;
    expect(await startFromBrand(clientWith({ vault: "not a kit" }).api, null, engine)).toBe(false);
  });

  it("puts the kit's colours on the deck being made", async () => {
    const applyBatch = vi.fn();
    const engine = { applyBatch } as never;
    expect(await startFromBrand(clientWith({ vault: KIT }).api, null, engine)).toBe(true);
    expect(applyBatch).toHaveBeenCalledTimes(1);
    expect(applyBatch.mock.calls[0]?.[0]).toEqual([["edit_theme", { patch: { colors: { accent1: "#0b5cad" } } }]]);
  });
});
