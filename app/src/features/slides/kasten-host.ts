// The Slides editor's host inside Kasten: a deck is a file in the vault, saved
// through the core with the hash it was read with; images are vault files.

import type { SaveOutcome, SlidesHost } from "@kasten-slides/react";

import { inDemo } from "../../demo/flag";
import { inTauri } from "../../lib/api";
import { fillShowScreen, presentScreens } from "../../lib/present-screen";
import { fileUrl } from "../../lib/vault/file-url";
import type { VaultClient } from "../../lib/vault/types";
import { coverWindow } from "../browser/cover";
import { holdForShow } from "../browser/show";
import { diagramRevision, drawDiagramPicture, editDiagramPicture, pickDiagramPicture, watchDiagrams } from "../diagrams/slides";
import { usePrefs } from "../workspace/prefs";
import { contentHash } from "../workspace/preview/vault-text";
import { AiTab } from "./AiTab";
import { deckAiSource } from "./ai-status";
import { galleryHost } from "./gallery-host";
import { onBibFiles } from "./events";
import { pageHost } from "./page-host";
import { allowEmbeds, embeddedPages, openTauriPresenter } from "./presenter-link";
import { rehearsalStore } from "./rehearse/store";
import { useDecks } from "./store";
import { webPreviewHost } from "./web-preview";

export interface KastenHost extends SlidesHost {
  /** The hash of the file as the editor last read or wrote it. */
  readonly baseHash: string;
}

/** A host for the deck at `path`, whose text was read with `hash`. */
export function kastenHost(client: VaultClient, path: string, hash: string, notify: (message: string) => void): KastenHost {
  let base = hash;
  return {
    deckPath: path,
    // The assistant tab: Kasten's chat, told which slide and elements are selected.
    aiPanel: AiTab,
    // What it is doing for this deck shows on the editor's Assistant button, panel open or not.
    aiStatus: deckAiSource(path),
    // The images drawer: the vault's assets, their small copies, where each is used.
    ...galleryHost(client),
    // Templates: plain deck files in the vault's `templates/slides/`, saved from a deck and put on a deck from Slides' File menu.
    templates: {
      async list() {
        return (await client.deckTemplates()).filter((deck) => !deck.problem).map((deck) => ({ id: deck.path, title: deck.title, slides: deck.slides }));
      },
      async read(id) {
        return (await client.deck(id)).text;
      },
      async save(title, text) {
        const saved = await client.createDeckTemplate(title, text);
        void useDecks.getState().load();
        return saved;
      },
    },
    // Pages: Insert → Page… (choose, read, update), links to pages, the side panel of a presentation, and hearing that a page changed.
    ...pageHost(client),
    // The other decks of the vault, for Slide → Import layouts…: their titles, and each as the text of its file.
    decks: {
      async list() {
        return (await client.decks()).filter((deck) => !deck.problem).map((deck) => ({ id: deck.path, title: deck.title, slides: deck.slides }));
      },
      async read(id) {
        return (await client.deck(id)).text;
      },
    },
    // Diagrams: Insert → Diagram… and Edit diagram, on the vault's diagrams; and, for a picture whose diagram changed since it was drawn,
    // the diagram's version now, a fresh picture without opening its editor, and hearing that a diagram changed.
    pickDiagram: () => pickDiagramPicture(client, path),
    editDiagram: (source) => editDiagramPicture(client, source),
    diagramRevision: (source) => diagramRevision(client, source),
    drawDiagram: (source) => drawDiagramPicture(client, source),
    watchDiagrams,
    // The star beside the deck's name is the sidebar's favourite: the same list, so each shows what the other did.
    favourite: {
      isOn: () => usePrefs.getState().favourites.includes(path),
      set(on) {
        if (on !== usePrefs.getState().favourites.includes(path)) usePrefs.getState().toggleFavourite(path);
      },
      watch: (onChange) => usePrefs.subscribe((now, before) => now.favourites !== before.favourites && onChange()),
    },
    get baseHash() {
      return base;
    },
    // The editor took a version from outside: saves build on that one.
    synced(text) {
      base = contentHash(text);
    },
    async save(text, options): Promise<SaveOutcome> {
      // Saving over what changed is a choice the person made: take the file's current version as the base.
      if (options?.overwrite) base = (await client.deck(path)).hash;
      const saved = await client.saveDeck(path, text, base);
      if (saved.status === "conflict") return { status: "conflict", theirs: saved.deck.text, copy: saved.copy };
      base = saved.deck.hash;
      return { status: "saved" };
    },
    // The vault's `.bib` files are the bibliography citations are looked up in; a change to one is told to the editor.
    references: () => client.references(),
    watchReferences: (onChange) => onBibFiles(onChange),
    imageUrl: (image) => fileUrl(image) ?? undefined,
    readImage: (image) => client.readAsset(image).catch(() => undefined),
    // The desktop app saves into Downloads under a name that is free; the preview downloads.
    async deliver(file) {
      const where = await client.saveDownload(file.name, file.bytes, file.type);
      notify(where === file.name ? `${file.name} downloaded.` : `Saved ${where}`);
    },
    notify,
    // Presenting in the desktop app: the presenter's view is a window of its own, the screen is the window's, and the pages the deck embeds
    // may load in their frames for as long as it is presented. A web page, beside a slide or from a link in the show, is the browser's native
    // view (when the browser is on). While a presentation fills the window, a web link must not open a browser tab beneath it. In a browser
    // the editor's own ways serve.
    ...(inTauri()
      ? {
          openPresenter: () => openTauriPresenter(path),
          // The show fills the display chosen in "Present on", and the choice of displays is offered with the slideshow options.
          fillScreen: fillShowScreen,
          screens: presentScreens,
          webPreview: webPreviewHost(),
          // Rehearsals are a person's practice, kept on this computer in the app's data folder, not in the vault.
          rehearsals: rehearsalStore(),
          async willPresent(deck: unknown) {
            const uncover = coverWindow();
            // A native web view (a browser tab, an editor's preview) is drawn above the window: the show holds all of it, and the
            // toasts and the chat dock keep quiet, until it ends.
            const release = holdForShow();
            try {
              await allowEmbeds(embeddedPages(deck));
            } catch (err) {
              release();
              uncover();
              throw err;
            }
            return () => {
              release();
              uncover();
              void allowEmbeds([]);
            };
          },
        }
      : // The promo demo's stand-in views serve the web preview in the browser preview too.
        inDemo()
        ? { webPreview: webPreviewHost() }
        : {}),
  };
}
