// The Slides editor's brand kit inside Kasten: one small file in the vault's `templates/brand/`, for the vault or for the project the deck
// is in. The editor writes the text; the vault client carries it to the core's ops, which keep it as it was given.

import type { BrandHost, BrandScope } from "@kasten-slides/react";
import type { DeckEngine } from "@kasten-slides/wasm";

import type { VaultClient } from "../../lib/vault/types";

/** The project a deck is in (the folder under `projects/`), or null for a deck kept elsewhere. */
export const projectOfDeck = (path: string): string | null => /^projects\/([^/]+)\//.exec(path)?.[1] ?? null;

/**
 * Puts the vault's (or the project's) brand kit on a deck that is being made, before it is saved: its colours, fonts and logo. A deck with
 * no kit to start from is left as it is, and so is one whose kit cannot be read or used: making a deck never fails for a kit. The editor's
 * package is loaded only when there is a kit.
 */
export async function startFromBrand(client: VaultClient, project: string | null, engine: DeckEngine): Promise<boolean> {
  try {
    const file = await client.brandKit?.(project);
    if (!file) return false;
    const { applyBrandToNewDeck, parseKit } = await import("@kasten-slides/react");
    const kit = parseKit(file.text);
    return kit ? applyBrandToNewDeck(engine, kit) : false;
  } catch {
    return false;
  }
}

/** The host's brand kit for the deck at `path`; none where the client cannot keep one (the browser preview). */
export function brandHost(client: VaultClient, path: string): { brand?: BrandHost } {
  const read = client.brandKit?.bind(client);
  const save = client.saveBrandKit?.bind(client);
  if (!read || !save) return {};
  const project = projectOfDeck(path);
  return {
    brand: {
      project,
      async read() {
        const file = await read(project);
        return file ? { text: file.text, scope: (file.project ? "project" : "vault") satisfies BrandScope } : null;
      },
      async save(text, scope) {
        await save(scope === "project" ? project : null, text);
      },
    },
  };
}
