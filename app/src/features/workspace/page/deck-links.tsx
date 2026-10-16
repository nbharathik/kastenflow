// What a page's editor knows about slide decks, for `![[talk.deck]]` embeds
// and /deck: the decks to pick from, making one in the page's project, drawing
// one inside the page (slide by slide, loaded when the first is shown), and
// opening one.

import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import type { NoteMeta, VaultClient } from "../../../lib/vault/types";
import { ViewBoundary } from "../../../ui/ViewBoundary";
import { UpdatedBadge } from "../../health/UpdatedBadge";
import type { LinkProvider } from "../../pages/editor/links";
import { useDecks } from "../../slides/store";
import { useWorkspace } from "../store";
import { projectTitle } from "../../boards/store";

type DeckLinks = Required<Pick<LinkProvider, "decks" | "createDeck" | "mountDeck" | "openDeck">>;

/** The deck view and the slide engine load when the first deck is shown. */
const LazyDeckEmbed = lazy(() => import("../../slides/DeckEmbedView").then((m) => ({ default: m.DeckEmbedView })));

export function deckLinks(client: VaultClient, page: () => NoteMeta | undefined): DeckLinks {
  return {
    decks: () => {
      const notes = useWorkspace.getState().notes;
      return [...useDecks.getState().list]
        .filter((d) => !d.problem)
        .sort((a, b) => b.modified - a.modified)
        .map((d) => ({ path: d.path, title: d.title, hint: d.project ? projectTitle(notes, d.project) : undefined }));
    },
    createDeck: async (title) => {
      try {
        // The slide engine loads only now: a page that shows no deck never needs it.
        const { DeckEngine, loadSlides } = await import("@kasten-slides/wasm");
        await loadSlides();
        const engine = DeckEngine.create(title, "Light");
        const text = engine.save();
        engine.dispose();
        const path = await client.createDeck(title, page()?.project ?? null, text);
        await useDecks.getState().load();
        return path;
      } catch (err) {
        useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    mountDeck: (host, path) => {
      const root = createRoot(host);
      root.render(
        <ViewBoundary place={path}>
          <Suspense fallback={<p className="px-3 py-6 text-center text-13 text-muted">Opening the deck…</p>}>
            <LazyDeckEmbed path={path} />
          </Suspense>
          <UpdatedBadge kind="deck" path={path} />
        </ViewBoundary>,
      );
      return () => root.unmount();
    },
    openDeck: (path, how) => useWorkspace.getState().openPath(path, how),
  };
}
