// Presenting a deck from the page that shows it: the same presentation the
// Slides editor opens, over the whole window, with the desktop app's own hooks
// (the pages a deck embeds may load while it is presented, and the screen is
// the window's). No presenter's window: that is the editor's.

import { openPresentation } from "@kasten-slides/react";
import type { Deck } from "@kasten-slides/wasm";

import type { VaultClient } from "../../lib/vault/types";
import { kastenHost } from "./kasten-host";

/** Opens a presentation of `deck` (the deck at `path`) from the slide at `start`. */
export async function presentFrom(client: VaultClient, path: string, deck: Deck, start: number, notify: (message: string) => void): Promise<void> {
  const host = kastenHost(client, path, "", notify);
  const finished = await host.willPresent?.(deck);
  let release: (() => void) | null = null;
  // F toggles the window's own full screen, where the app has one.
  const fullscreen = host.fillScreen
    ? () => {
        if (release) {
          release();
          release = null;
        } else {
          void host.fillScreen?.(() => (release = null)).then((leave) => (release = leave));
        }
      }
    : undefined;
  openPresentation({
    deck,
    start,
    imageUrl: (image) => host.imageUrl(image),
    // The vault's pages: the ones the deck embeds are read through the host, and a link to one opens its panel.
    pages: host,
    ...(fullscreen ? { fullscreen } : {}),
    onClosed: () => {
      finished?.();
      release?.();
    },
  });
}
