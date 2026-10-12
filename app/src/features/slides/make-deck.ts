// Making a deck from a template and opening it: what the cards of the Start row do in one press.

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";

import type { VaultClient } from "../../lib/vault/types";
import { type OpenHow, useWorkspace } from "../workspace/store";
import { useDecks } from "./store";

/** What a deck made from the Start row is called until the person names it in the editor. */
export const UNTITLED = "Untitled presentation";

export interface NewDeckOptions {
  title?: string;
  project?: string | null;
  /** A built-in template's name. */
  template: string;
  size?: { w: number; h: number };
  /** The template's example slides; a blank presentation has none. */
  examples: boolean;
}

/** Makes the deck in the vault and answers its path. The list of decks is read again. */
export async function makeDeck(client: VaultClient, { title = UNTITLED, project = null, template, size = { w: 960, h: 540 }, examples }: NewDeckOptions): Promise<string> {
  await loadSlides();
  const engine = DeckEngine.create(title, template, undefined, { size, examples });
  const text = engine.save();
  engine.dispose();
  const path = await client.createDeck(title, project, text);
  await useDecks.getState().load();
  return path;
}

/** Makes a deck and opens it here (or as `how` asks); a failure is told to the person, and nothing opens. */
export async function startDeck(options: NewDeckOptions, how: OpenHow = "here"): Promise<string | null> {
  const { client, openPath, toast } = useWorkspace.getState();
  if (!client) return null;
  try {
    const path = await makeDeck(client, options);
    openPath(path, how);
    return path;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
    return null;
  }
}
