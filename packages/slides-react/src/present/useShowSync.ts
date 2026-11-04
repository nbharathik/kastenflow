// The audience window's side of the link to the presenter's window. The presenter's window is given the deck (and the addresses of its
// pictures) when it comes and when it asks; after that it is told only where the talk is and, a moment after the person stops
// editing, what changed in the deck. The two follow each other, play the same videos together, show each other's laser and ink, and the
// show says every 2 s that it is there.

import type { Deck } from "@kasten-slides/wasm";
import type { RevealApi } from "reveal.js";
import { type MutableRefObject, useEffect, useRef } from "react";

import type { ImageUrl } from "../render/index.ts";
import { PatchMaker } from "./deck-patch.ts";
import type { InkStore } from "./ink/store.ts";
import type { MediaLink } from "./media.ts";
import { BEAT_MS, imagesOf } from "./show-images.ts";
import type { ShowScreens } from "./runtime/chrome.js";
import type { PresentSync } from "./sync.ts";

/** How long after the last edit the presenter's window is told about it. */
export const EDIT_MS = 250;

export interface ShowSyncInput {
  reveal: RevealApi | null;
  sync: PresentSync | null | undefined;
  deck: Deck;
  imageUrl: ImageUrl;
  rehearse: boolean | undefined;
  /** When the talk began. */
  since: MutableRefObject<number>;
  /** Set while this window is applying the other's position, so that it is not said back. */
  applying: MutableRefObject<boolean>;
  media: MediaLink;
  ink: InkStore;
  latest: MutableRefObject<{ onExit(): void; screens?: ShowScreens | undefined }>;
}

export function useShowSync({ reveal, sync, deck, imageUrl, rehearse, since, applying, media, ink, latest }: ShowSyncInput): void {
  const maker = useRef(new PatchMaker());
  // The deck as it is now, for a window that asks for it later.
  const current = useRef({ deck, imageUrl });
  current.current = { deck, imageUrl };

  // The presenter's window: it gets the deck when it comes and when it asks, and after that only where the talk is.
  useEffect(() => {
    if (!reveal || !sync) return;
    const introduce = () => {
      const { deck: shown, imageUrl: urls } = current.current;
      const images = imagesOf(shown, urls);
      maker.current.reset(shown, images);
      sync.post({ type: "deck", deck: shown, images, state: reveal.getState(), since: since.current });
      // Said with every deck: the presenter's window may open after the talk began, and hears it when it asks.
      if (rehearse) sync.post({ type: "rehearse" });
    };
    const beat = setInterval(() => sync.post({ type: "beat" }), BEAT_MS);
    const stop = sync.subscribe((message) => {
      if (message.type === "hello") introduce();
      else if (message.type === "end") latest.current.onExit();
      // The presenter's window asks to change screens: the window moves, this page stays (slide, step and timer are kept).
      else if (message.type === "screen") {
        const where = latest.current.screens;
        if (message.target === "swap") where?.swap();
        else where?.moveTo(message.target);
      } else if (message.type === "media") media.receive(message.media);
      else if (message.type === "ink") ink.receive(message.ink);
      else if (message.type === "pointer") ink.receiveLaser(message.at);
      else if (message.type === "state") {
        applying.current = true;
        try {
          // reveal.js takes a state with any part left out; its typing says every part is there.
          reveal.setState(message.state as unknown as Parameters<RevealApi["setState"]>[0]);
        } finally {
          applying.current = false;
        }
      }
    });
    introduce();
    return () => {
      clearInterval(beat);
      stop();
    };
  }, [reveal, sync, rehearse, since, applying, media, ink, latest]);

  // An edit of the deck reaches the presenter's window a moment after the person stops, and only what changed in it.
  useEffect(() => {
    if (!reveal || !sync) return;
    const timer = setTimeout(() => {
      const patch = maker.current.make(deck, imagesOf(deck, imageUrl));
      if (patch) sync.post({ type: "edit", since: since.current, patch });
    }, EDIT_MS);
    return () => clearTimeout(timer);
  }, [reveal, sync, deck, imageUrl, since]);
}
