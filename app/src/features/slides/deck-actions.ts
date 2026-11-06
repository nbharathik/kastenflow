import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { inTauri } from "../../lib/api";
import type { VaultClient } from "../../lib/vault/types";
import { goToSlides } from "./return-to-slides";
import { useSlideNumbers } from "./slide-numbers-state";

/** The desktop window goes full screen with the editor, and back with it. A refusal changes nothing: the editor still covers the app's window. */
export async function setWindowFullScreen(on: boolean): Promise<void> {
  if (!inTauri()) return;
  try {
    const win = getCurrentWindow();
    // Already as asked (the person put the window there themselves): leave it as it is when the editor goes.
    if ((await win.isFullscreen()) === on) return;
    await win.setFullscreen(on);
  } catch {
    // Not allowed here.
  }
}

/** Gives the deck at `path` another name: its title changes, and the file keeps its own. */
export async function renameDeck(client: VaultClient, path: string, title: string): Promise<void> {
  const name = title.trim();
  if (!name) return;
  const [file] = await Promise.all([client.deck(path), loadSlides()]);
  const engine = DeckEngine.open(file.text);
  try {
    if (engine.deck.title === name) return;
    engine.apply("set_title", { title: name });
    const saved = await client.saveDeck(path, engine.save(), file.hash);
    if (saved.status === "conflict") throw new Error("The deck changed while you were renaming it. Try again.");
  } finally {
    engine.dispose();
  }
}

/** Saves a copy of the deck at `path`, every slide of it, under `title` and with an id of its own, in the same project; answers its path. */
export async function duplicateDeck(client: VaultClient, path: string, title: string, project: string | null | undefined): Promise<string> {
  const [file] = await Promise.all([client.deck(path), loadSlides()]);
  const engine = DeckEngine.fromTemplate(file.text, title.trim(), true);
  try {
    return await client.createDeck(title.trim(), project ?? null, engine.save());
  } finally {
    engine.dispose();
  }
}

/**
 * What the editor calls on the app: Home goes to the Slides home, which opens in a tab of its own so this deck stays open (its tab
 * brings it back). Slide numbers opens the app's dialog for the numbers of every deck, which the editor's Master dialog links to (a
 * deck holds no setting for them). Full screen takes the desktop window full screen too. One object, so the editor is not given the
 * actions again on every draw.
 */
export const DECK_ACTIONS = {
  home: () => goToSlides(),
  slideNumbers: () => useSlideNumbers.getState().show(),
  fullScreen: (on: boolean) => setWindowFullScreen(on),
};
