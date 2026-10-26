// Presenting a deck from the page that shows it: the same presentation the
// Slides editor opens, over the whole window, with the desktop app's own hooks
// (the pages a deck embeds may load while it is presented, and the screen is
// the window's). No presenter's window: that is the editor's.

import { openPresentation, presenting, readControls, showScreen } from "@kasten-slides/react";
import type { Deck } from "@kasten-slides/wasm";

import type { VaultClient } from "../../lib/vault/types";
import { kastenHost } from "./kasten-host";

/** Opens a presentation of `deck` (the deck at `path`) from the slide at `start`. */
export async function presentFrom(client: VaultClient, path: string, deck: Deck, start: number, notify: (message: string) => void): Promise<void> {
  // One talk at a time: asking again must not make the app get ready (and hold the window) for a show that never opens.
  if (presenting()) return;
  const host = kastenHost(client, path, "", notify);
  const finished = await host.willPresent?.(deck);
  let close: (() => void) | undefined;
  // The show fills the screen from the start, and F gives it back and takes it again; the show ends with it when the person leaves
  // full screen another way.
  const screen = showScreen(host.fillScreen?.bind(host), () => close?.());
  try {
    await screen?.enter();
    const presentation = openPresentation({
      deck,
      start,
      imageUrl: (image) => host.imageUrl(image),
      controls: readControls(),
      // The vault's pages: the ones the deck embeds are read through the host, and a link to one opens its panel.
      pages: host,
      ...(screen ? { fullscreen: screen.toggle } : {}),
      onClosed: () => {
        finished?.();
        screen?.release();
      },
    });
    close = presentation.close;
  } catch (error) {
    finished?.();
    screen?.release();
    throw error;
  }
}
